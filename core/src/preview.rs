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
    /// Ingrandimento oltre 1:1.
    Nativo,
}

impl Livello {
    /// I lati lunghi dei quattro livelli.
    ///
    /// Stessi numeri di `server/livelli.ts`, ed e' un vincolo: le due superfici
    /// devono produrre gli stessi byte per la stessa foto, altrimenti l'applicazione
    /// e la versione web sono due cose che si somigliano invece di una sola.
    /// La prova `i_livelli_sono_gli_stessi_delle_due_superfici` lo verifica.
    ///
    /// Il visore e' 2048 e non i 3840 che userebbe un'applicazione nativa a schermo
    /// intero su un Retina: un'immagine dentro una pagina non supera i ~2500 pixel
    /// reali, e ogni pixel oltre l'anteprima incorporata si paga con una decodifica
    /// piena del RAW -- 868 ms misurati su una Sony ARW.
    pub fn lato_lungo(self) -> Option<u32> {
        match self {
            Livello::Proxy => Some(256),
            Livello::Griglia => Some(512),
            Livello::Visore => Some(2048),
            Livello::Nativo => Some(3840),
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

/// Cosa c'e' dentro il file, guardando i primi byte invece dell'estensione.
///
/// L'estensione e' cio' che qualcuno ha scritto nel nome; la firma e' cio' che il file
/// e'. Un JPEG chiamato `.ARW` esiste, e va mostrato lo stesso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Formato {
    /// Contenitore TIFF: tutti i RAW dei corpi diffusi, piu' i TIFF veri.
    Tiff,
    /// JPEG diretto, senza contenitore.
    Jpeg,
    Png,
    Ignoto,
}

pub fn formato(dati: &[u8]) -> Formato {
    if dati.len() >= 8 && dati[0..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return Formato::Png;
    }
    if dati.len() >= 2 && dati[0] == 0xFF && dati[1] == 0xD8 {
        return Formato::Jpeg;
    }
    if dati.len() >= 4 && (&dati[0..2] == b"II" || &dati[0..2] == b"MM") {
        return Formato::Tiff;
    }
    Formato::Ignoto
}

fn decodifica_png(dati: &[u8], nome: &str) -> Risultato<Immagine> {
    let dec = png::Decoder::new(dati);
    let mut lettore = dec.read_info().map_err(|e| Errore::JpegIllegibile {
        file: nome.to_string(),
        causa: e.to_string(),
    })?;
    let mut buf = vec![0u8; lettore.output_buffer_size()];
    let info = lettore.next_frame(&mut buf).map_err(|e| Errore::JpegIllegibile {
        file: nome.to_string(),
        causa: e.to_string(),
    })?;
    let (w, h) = (info.width, info.height);
    // Si porta tutto a RGB a 8 bit: il resto del motore conosce un formato solo.
    let canali = info.color_type.samples();
    let profondita = if info.bit_depth == png::BitDepth::Sixteen { 2 } else { 1 };
    let mut pixel = Vec::with_capacity((w * h * 3) as usize);
    for i in 0..(w as usize * h as usize) {
        let base = i * canali * profondita;
        let leggi = |k: usize| -> u8 { buf.get(base + k * profondita).copied().unwrap_or(0) };
        match canali {
            1 | 2 => {
                let g = leggi(0);
                pixel.extend_from_slice(&[g, g, g]);
            }
            _ => pixel.extend_from_slice(&[leggi(0), leggi(1), leggi(2)]),
        }
    }
    Ok(Immagine { larghezza: w, altezza: h, pixel })
}

/// Estrae l'immagine piu' grande disponibile, orientata, senza ridimensionarla.
///
/// Per un RAW e' l'anteprima incorporata; per un JPEG o un PNG e' l'immagine stessa.
pub fn incorporata(percorso: &Path) -> Risultato<(Immagine, tiff::Struttura)> {
    let (dati, nome) = mappa(percorso)?;

    let vuota = |orientamento: u16| tiff::Struttura {
        anteprime: Vec::new(),
        orientamento,
        lato_lungo_scatto: None,
    };

    match formato(&dati) {
        Formato::Png => return Ok((decodifica_png(&dati, &nome)?, vuota(1))),
        Formato::Jpeg => {
            // Un JPEG puo' portare l'orientamento in un blocco EXIF, che e' un TIFF
            // annidato: si prova a leggerlo, e se non c'e' si assume dritto.
            let img = decodifica_jpeg(&dati, &nome)?;
            let orientamento = orientamento_exif_in_jpeg(&dati).unwrap_or(1);
            return Ok((orienta(img, orientamento), vuota(orientamento)));
        }
        Formato::Ignoto => {
            return Err(Errore::NonTiff { file: nome });
        }
        Formato::Tiff => {}
    }

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

/// Cerca il blocco EXIF di un JPEG e ne legge l'orientamento.
/// Il blocco e' un TIFF completo dentro un marcatore APP1: si riusa lo stesso lettore,
/// coi suoi controlli sui limiti, invece di scriverne un secondo piu' distratto.
fn orientamento_exif_in_jpeg(dati: &[u8]) -> Option<u16> {
    let mut i = 2usize;
    while i + 4 <= dati.len() {
        if dati[i] != 0xFF {
            return None;
        }
        let marcatore = dati[i + 1];
        // SOS: da qui in poi ci sono i dati compressi, non piu' marcatori.
        if marcatore == 0xDA {
            return None;
        }
        let lunghezza = u16::from_be_bytes([dati.get(i + 2).copied()?, dati.get(i + 3).copied()?]) as usize;
        if lunghezza < 2 {
            return None;
        }
        if marcatore == 0xE1 {
            let inizio = i + 4;
            let fine = (inizio + lunghezza - 2).min(dati.len());
            let blocco = dati.get(inizio..fine)?;
            if blocco.len() > 6 && &blocco[0..6] == b"Exif\0\0" {
                return tiff::leggi(&blocco[6..], "<exif>").ok().map(|s| s.orientamento);
            }
        }
        i += 2 + lunghezza;
    }
    None
}

/// L'anteprima a un lato lungo qualunque. E' la primitiva: i livelli ci si appoggiano.
pub fn anteprima_lato(percorso: &Path, lato_richiesto: Option<u32>) -> Risultato<Anteprima> {
    let (immagine, _) = incorporata(percorso)?;
    let richiesto = match lato_richiesto {
        Some(l) if l > 0 => l,
        _ => return Ok(Anteprima { immagine, da_incorporata: true, troncata: false }),
    };
    let troncata = immagine.lato_lungo() < richiesto;
    let immagine = riduci(immagine, richiesto)?;
    Ok(Anteprima { immagine, da_incorporata: true, troncata })
}

/// L'anteprima a un livello, dall'immagine incorporata quando basta.
///
/// Quando non basta il risultato e' marcato `troncata`: sta al chiamante decidere se
/// interpolare o chiedere la decodifica piena, che e' lenta e vive in un altro processo.
pub fn anteprima(percorso: &Path, livello: Livello) -> Risultato<Anteprima> {
    anteprima_lato(percorso, livello.lato_lungo())
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
        assert_eq!(Livello::Visore.lato_lungo(), Some(2048));
        assert_eq!(Livello::Nativo.lato_lungo(), Some(3840));
    }

    #[test]
    fn i_livelli_sono_gli_stessi_delle_due_superfici() {
        // `server/livelli.ts` e' la stessa tabella per il backend e per
        // l'interfaccia. Se qui cambia un numero e li' no, l'applicazione desktop e
        // la versione web servono immagini diverse per la stessa foto -- e sono due
        // prodotti, non uno.
        let ts = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../server/livelli.ts"),
        )
        .expect("server/livelli.ts non trovato");
        for (nome, lato) in [
            ("proxy", 256),
            ("griglia", 512),
            ("visore", 2048),
            ("nativo", 3840),
        ] {
            let atteso = format!("nome: \"{nome}\", lato: {lato}");
            assert!(
                ts.contains(&atteso),
                "server/livelli.ts non dichiara `{atteso}`"
            );
        }
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
    fn il_formato_si_riconosce_dai_byte_non_dall_estensione() {
        assert_eq!(formato(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]), Formato::Png);
        assert_eq!(formato(&[0xFF, 0xD8, 0xFF, 0xE0]), Formato::Jpeg);
        assert_eq!(formato(b"II*\0"), Formato::Tiff);
        assert_eq!(formato(b"MM\0*"), Formato::Tiff);
        assert_eq!(formato(b"ciao"), Formato::Ignoto);
        assert_eq!(formato(&[]), Formato::Ignoto);
    }

    #[test]
    fn un_jpeg_scritto_da_noi_si_rilegge() {
        let originale = quadro(64, 48);
        let byte = in_jpeg(&originale, 92).unwrap();
        let riletto = decodifica_jpeg(&byte, "andata_e_ritorno").unwrap();
        assert_eq!((riletto.larghezza, riletto.altezza), (64, 48));
    }

    #[test]
    fn un_jpeg_troncato_e_un_errore_non_un_panico() {
        let byte = in_jpeg(&quadro(64, 48), 82).unwrap();
        for frazione in [2, 3, 4, 8] {
            let _ = decodifica_jpeg(&byte[..byte.len() / frazione], "troncato");
        }
    }

    #[test]
    fn senza_lato_richiesto_non_si_ridimensiona() {
        // La primitiva con `None` restituisce cio' che ha trovato, e non e' troncata:
        // nessuno ha chiesto una dimensione che non c'era.
        let img = quadro(100, 50);
        let a = Anteprima { immagine: img, da_incorporata: true, troncata: false };
        assert_eq!(a.immagine.lato_lungo(), 100);
        assert!(!a.troncata);
    }

    #[test]
    fn un_file_che_non_esiste_e_non_leggibile() {
        let e = anteprima(Path::new("/non/esiste/mai.ARW"), Livello::Griglia).unwrap_err();
        assert_eq!(e.codice(), "non_leggibile");
    }
}
