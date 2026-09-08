//! Anteprime: leggere invece di ricalcolare.
//!
//! Ogni RAW porta gia' dentro di se' un JPEG scritto dalla fotocamera. Estrarlo costa
//! una decodifica JPEG; ricostruirlo dal RAW costa una demosaicizzazione, cioe' due
//! ordini di grandezza in piu'. Misurato su 85 Sony ARW da 47 MB: 7,9 ms per foto
//! contro i 1859 di `sips`.
//!
//! La trappola sta nel fatto che quel JPEG **non e' sempre grande abbastanza**. Su una
//! NEF Nikon e' grande quanto lo scatto; su una ARW Sony si ferma a 1616 px. Chiedere
//! 3840 px non fa comparire i pixel che non ci sono: il chiamante deve sapere se ha
//! ricevuto quello che ha chiesto o il massimo disponibile.

use crate::error::{Errore, Risultato};
use crate::tiff;
use fast_image_resize::images::Image;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use memmap2::Mmap;
use std::fs::File;
use std::path::Path;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;
use zune_jpeg::JpegDecoder;

/// I quattro livelli, con i lati lunghi che li definiscono.
///
/// Non sono una scala continua ma quattro usi distinti, e per questo hanno cache
/// separate: la striscia consuma proxy mentre la griglia consuma celle, e se
/// condividessero un budget scorrere la griglia svuoterebbe la striscia.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Livello {
    /// Striscia, vassoio, riempimento della griglia mentre il resto arriva.
    Proxy,
    /// Celle della griglia.
    Griglia,
    /// Foto aperta nel visore.
    Visore,
    /// Ingrandimento oltre 1:1. Non ha un lato lungo: e' il file.
    Nativo,
}

impl Livello {
    pub fn lato_lungo(self) -> Option<u32> {
        match self {
            Livello::Proxy => Some(256),
            Livello::Griglia => Some(512),
            Livello::Visore => Some(3840),
            Livello::Nativo => None,
        }
    }

    pub fn nome(self) -> &'static str {
        match self {
            Livello::Proxy => "proxy",
            Livello::Griglia => "griglia",
            Livello::Visore => "visore",
            Livello::Nativo => "nativo",
        }
    }

    pub fn da_nome(s: &str) -> Option<Livello> {
        match s {
            "proxy" => Some(Livello::Proxy),
            "griglia" => Some(Livello::Griglia),
            "visore" => Some(Livello::Visore),
            "nativo" => Some(Livello::Nativo),
            _ => None,
        }
    }
}

/// Un'immagine in memoria, RGB a 8 bit, gia' orientata.
#[derive(Debug, Clone)]
pub struct Immagine {
    pub larghezza: u32,
    pub altezza: u32,
    pub pixel: Vec<u8>,
}

impl Immagine {
    pub fn peso_byte(&self) -> usize {
        self.pixel.len()
    }

    pub fn lato_lungo(&self) -> u32 {
        self.larghezza.max(self.altezza)
    }
}

/// Il risultato di una richiesta di anteprima, con la provenienza dichiarata.
#[derive(Debug, Clone)]
pub struct Anteprima {
    pub immagine: Immagine,
    /// Falso quando l'anteprima incorporata non bastava e si e' dovuto decodificare.
    pub da_incorporata: bool,
    /// Vero quando si e' restituito il massimo disponibile invece del lato richiesto.
    /// Chi disegna deve saperlo: interpolare 1616 px fino a 3840 e' una scelta,
    /// non un dettaglio.
    pub troncata: bool,
}

/// Cio' che si puo' sapere di un RAW senza pagare una decodifica.
#[derive(Debug, Clone)]
pub struct Diagnosi {
    pub file: String,
    pub byte_file: u64,
    /// Lato lungo dell'anteprima incorporata piu' grande, misurato davvero
    /// decodificandone l'intestazione — non quello dichiarato dall'IFD, che a volte
    /// descrive lo scatto e non l'anteprima.
    pub lato_lungo_incorporata: u32,
    pub lato_lungo_scatto: Option<u32>,
    pub orientamento: u16,
    pub anteprime_trovate: usize,
    /// I livelli che questa anteprima incorporata riesce a servire senza decodifica piena.
    pub livelli_serviti: Vec<&'static str>,
}

fn mappa(percorso: &Path) -> Risultato<(Mmap, String)> {
    let nome = percorso.to_string_lossy().into_owned();
    let f = File::open(percorso).map_err(|e| Errore::NonLeggibile {
        file: nome.clone(),
        causa: e.to_string(),
    })?;
    // SAFETY: la mappa non sopravvive alla funzione che la usa, e il file viene solo letto.
    // Un file troncato sotto i piedi produrrebbe SIGBUS: e' il motivo per cui la
    // decodifica piena, che e' lunga, gira in un processo separato.
    let m = unsafe { Mmap::map(&f) }.map_err(|e| Errore::NonLeggibile {
        file: nome.clone(),
        causa: e.to_string(),
    })?;
    Ok((m, nome))
}

fn decodifica_jpeg(fetta: &[u8], nome: &str) -> Risultato<Immagine> {
    let opzioni = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut dec = JpegDecoder::new_with_options(fetta, opzioni);
    let pixel = dec.decode().map_err(|e| Errore::JpegIllegibile {
        file: nome.to_string(),
        causa: e.to_string(),
    })?;
    let (w, h) = dec.dimensions().ok_or_else(|| Errore::JpegIllegibile {
        file: nome.to_string(),
        causa: "il decodificatore non dichiara le dimensioni".into(),
    })?;
    let (larghezza, altezza) = (w as u32, h as u32);
    // Il decodificatore potrebbe restituire meno byte di quanti le dimensioni promettono.
    let attesi = larghezza as usize * altezza as usize * 3;
    if pixel.len() < attesi {
        return Err(Errore::JpegIllegibile {
            file: nome.to_string(),
            causa: format!("{} byte per un'immagine che ne richiede {attesi}", pixel.len()),
        });
    }
    Ok(Immagine { larghezza, altezza, pixel })
}

/// Applica l'orientamento EXIF ai pixel, cosi' che nessuno a valle debba ricordarsene.
pub fn orienta(img: Immagine, orientamento: u16) -> Immagine {
    if orientamento <= 1 || orientamento > 8 {
        return img;
    }
    let (w, h) = (img.larghezza as usize, img.altezza as usize);
    let ruota = matches!(orientamento, 5 | 6 | 7 | 8);
    let (nw, nh) = if ruota { (h, w) } else { (w, h) };
    let mut fuori = vec![0u8; nw * nh * 3];

    for y in 0..h {
        for x in 0..w {
            let (dx, dy) = match orientamento {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (h - 1 - y, x),
                7 => (h - 1 - y, w - 1 - x),
                8 => (y, w - 1 - x),
                _ => (x, y),
            };
            let da = (y * w + x) * 3;
            let a = (dy * nw + dx) * 3;
            fuori[a..a + 3].copy_from_slice(&img.pixel[da..da + 3]);
        }
    }
    Immagine { larghezza: nw as u32, altezza: nh as u32, pixel: fuori }
}

/// Riduce al lato lungo richiesto. Non ingrandisce mai: restituire pixel inventati
/// come se fossero letti e' esattamente il difetto che vogliamo poter dichiarare.
pub fn riduci(img: Immagine, lato_lungo: u32) -> Risultato<Immagine> {
    let attuale = img.lato_lungo();
    if attuale <= lato_lungo || attuale == 0 {
        return Ok(img);
    }
    let scala = lato_lungo as f64 / attuale as f64;
    let nw = ((img.larghezza as f64 * scala).round() as u32).max(1);
    let nh = ((img.altezza as f64 * scala).round() as u32).max(1);

    let sorgente = Image::from_vec_u8(img.larghezza, img.altezza, img.pixel, PixelType::U8x3)
        .map_err(|e| Errore::Malformato {
            file: "<memoria>".into(),
            dettaglio: e.to_string(),
        })?;
    let mut destinazione = Image::new(nw, nh, PixelType::U8x3);
    // CatmullRom: la nitidezza qui non e' estetica. Su una griglia di culling si decide
    // se uno scatto e' a fuoco, e un ridimensionamento morbido fa sembrare mosso cio'
    // che non lo e'.
    let opzioni = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::CatmullRom));
    Resizer::new()
        .resize(&sorgente, &mut destinazione, &opzioni)
        .map_err(|e| Errore::Malformato { file: "<memoria>".into(), dettaglio: e.to_string() })?;

    Ok(Immagine { larghezza: nw, altezza: nh, pixel: destinazione.into_vec() })
}

/// Estrae l'anteprima incorporata piu' grande, orientata, senza ridimensionarla.
pub fn incorporata(percorso: &Path) -> Risultato<(Immagine, tiff::Struttura)> {
    let (dati, nome) = mappa(percorso)?;
    let struttura = tiff::leggi(&dati, &nome)?;

    // I candidati si provano dal piu' grande al piu' piccolo: un file puo' dichiarare
    // un'anteprima che il decodificatore poi rifiuta, e in quel caso quella dopo va bene.
    let mut candidati: Vec<_> = struttura.anteprime.clone();
    candidati.sort_by_key(|a| std::cmp::Reverse(a.lunghezza));

    let mut ultimo: Option<Errore> = None;
    for c in &candidati {
        let fetta = &dati[c.inizio..c.inizio + c.lunghezza];
        match decodifica_jpeg(fetta, &nome) {
            Ok(img) => return Ok((orienta(img, struttura.orientamento), struttura)),
            Err(e) => ultimo = Some(e),
        }
    }
    Err(ultimo.unwrap_or(Errore::SenzaAnteprima { file: nome }))
}

/// L'anteprima a un livello, dall'immagine incorporata quando basta.
///
/// Quando non basta il risultato e' marcato `troncata`: sta al chiamante decidere se
/// interpolare o chiedere la decodifica piena, che e' lenta e vive in un altro processo.
pub fn anteprima(percorso: &Path, livello: Livello) -> Risultato<Anteprima> {
    let (immagine, _) = incorporata(percorso)?;
    let richiesto = match livello.lato_lungo() {
        Some(l) => l,
        None => {
            return Ok(Anteprima { immagine, da_incorporata: true, troncata: true });
        }
    };
    let disponibile = immagine.lato_lungo();
    let troncata = disponibile < richiesto;
    let immagine = riduci(immagine, richiesto)?;
    Ok(Anteprima { immagine, da_incorporata: true, troncata })
}

/// Misura la cartella prima di scegliere una soglia.
///
/// Il lato lungo dell'anteprima incorporata cambia da corpo a corpo, e con lui cambia
/// quali livelli si pagano in millisecondi e quali in secondi. E' il numero da leggere
/// prima di qualunque tempo, non una costante da fissare una volta.
pub fn diagnosi(percorso: &Path) -> Risultato<Diagnosi> {
    let (immagine, struttura) = incorporata(percorso)?;
    let byte_file = std::fs::metadata(percorso).map(|m| m.len()).unwrap_or(0);
    let lato = immagine.lato_lungo();

    let mut livelli_serviti = Vec::new();
    for l in [Livello::Proxy, Livello::Griglia, Livello::Visore] {
        if let Some(richiesto) = l.lato_lungo() {
            if lato >= richiesto {
                livelli_serviti.push(l.nome());
            }
        }
    }

    Ok(Diagnosi {
        file: percorso.to_string_lossy().into_owned(),
        byte_file,
        lato_lungo_incorporata: lato,
        lato_lungo_scatto: struttura.lato_lungo_scatto,
        orientamento: struttura.orientamento,
        anteprime_trovate: struttura.anteprime.len(),
        livelli_serviti,
    })
}

/// Codifica in JPEG per la cache su disco.
pub fn in_jpeg(img: &Immagine, qualita: u8) -> Risultato<Vec<u8>> {
    let mut fuori = Vec::new();
    let enc = jpeg_encoder::Encoder::new(&mut fuori, qualita);
    enc.encode(
        &img.pixel,
        img.larghezza as u16,
        img.altezza as u16,
        jpeg_encoder::ColorType::Rgb,
    )
    .map_err(|e| Errore::Scrittura { file: "<jpeg>".into(), causa: e.to_string() })?;
    Ok(fuori)
}

#[cfg(test)]
mod prove {
    use super::*;

    fn quadro(w: u32, h: u32) -> Immagine {
        let mut pixel = vec![0u8; (w * h * 3) as usize];
        // Un gradiente, cosi' che una rotazione sbagliata si veda nei valori.
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 3) as usize;
                pixel[i] = x as u8;
                pixel[i + 1] = y as u8;
                pixel[i + 2] = 0;
            }
        }
        Immagine { larghezza: w, altezza: h, pixel }
    }

    #[test]
    fn i_livelli_hanno_i_lati_dichiarati() {
        assert_eq!(Livello::Proxy.lato_lungo(), Some(256));
        assert_eq!(Livello::Griglia.lato_lungo(), Some(512));
        assert_eq!(Livello::Visore.lato_lungo(), Some(3840));
        assert_eq!(Livello::Nativo.lato_lungo(), None);
    }

    #[test]
    fn ridurre_conserva_le_proporzioni() {
        let r = riduci(quadro(1000, 500), 100).unwrap();
        assert_eq!(r.larghezza, 100);
        assert_eq!(r.altezza, 50);
    }

    #[test]
    fn ridurre_non_ingrandisce_mai() {
        let r = riduci(quadro(80, 40), 512).unwrap();
        assert_eq!((r.larghezza, r.altezza), (80, 40));
    }

    #[test]
    fn orientare_a_novanta_gradi_scambia_i_lati() {
        let r = orienta(quadro(10, 4), 6);
        assert_eq!((r.larghezza, r.altezza), (4, 10));
    }

    #[test]
    fn orientare_a_centottanta_conserva_i_lati_e_sposta_i_pixel() {
        let originale = quadro(4, 3);
        let r = orienta(originale.clone(), 3);
        assert_eq!((r.larghezza, r.altezza), (4, 3));
        // L'angolo in alto a sinistra diventa quello in basso a destra.
        let ultimo = r.pixel.len() - 3;
        assert_eq!(&r.pixel[ultimo..], &originale.pixel[0..3]);
    }

    #[test]
    fn un_orientamento_neutro_non_copia_niente() {
        let o = quadro(5, 5);
        assert_eq!(orienta(o.clone(), 1).pixel, o.pixel);
    }

    #[test]
    fn un_orientamento_assurdo_non_rompe() {
        let o = quadro(5, 5);
        assert_eq!(orienta(o.clone(), 42).pixel, o.pixel);
    }

    #[test]
    fn la_codifica_jpeg_produce_una_firma_valida() {
        let j = in_jpeg(&quadro(16, 16), 82).unwrap();
        assert_eq!(&j[0..2], &[0xFF, 0xD8]);
        assert_eq!(&j[j.len() - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn un_file_che_non_esiste_e_non_leggibile() {
        let e = anteprima(Path::new("/non/esiste/mai.ARW"), Livello::Griglia).unwrap_err();
        assert_eq!(e.codice(), "non_leggibile");
    }
}
