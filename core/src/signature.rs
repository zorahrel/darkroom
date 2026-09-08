//! Firma percettiva di uno scatto, per riconoscere le raffiche.
//!
//! Tre numeri diversi, non uno: la struttura dice se l'inquadratura e' la stessa, il
//! colore dice se la luce e' la stessa, la nitidezza dice quale dei due scatti e' a
//! fuoco. Servono tutti e tre perche' due scatti della stessa raffica hanno struttura
//! quasi identica e colore quasi identico, mentre due scatti di scene diverse sotto la
//! stessa luce hanno solo il colore in comune.

use crate::preview::Immagine;

/// Lato della griglia su cui si calcola l'impronta strutturale.
/// Nove per otto perche' la differenza fra colonne adiacenti produce 8 bit per riga.
const LATO_DHASH: usize = 8;

/// Lato della griglia del colore. Quattro per quattro: piu' fine di cosi' si comincia
/// a misurare il soggetto invece della luce.
const LATO_COLORE: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct Firma {
    /// Impronta strutturale: 64 bit di differenze fra pixel adiacenti.
    pub struttura: u64,
    /// Colore medio di 16 riquadri, centrato sulla media per non confondere
    /// «stessa scena piu' scura» con «scena diversa».
    pub colore: [i16; LATO_COLORE * LATO_COLORE * 3],
    /// Energia dei bordi: piu' alta dove l'immagine e' a fuoco.
    pub nitidezza: f32,
}

fn grigio(img: &Immagine, x: usize, y: usize) -> f32 {
    let i = (y * img.larghezza as usize + x) * 3;
    match img.pixel.get(i..i + 3) {
        // Coefficienti di luminanza: il verde pesa piu' del blu perche' l'occhio lo vede di piu'.
        Some(p) => 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32,
        None => 0.0,
    }
}

/// Media di un riquadro, campionando invece di scorrere tutto: la firma serve a
/// confrontare, non a misurare, e campionare costa una frazione.
fn media_riquadro(img: &Immagine, x0: usize, y0: usize, w: usize, h: usize) -> [f32; 3] {
    let (iw, ih) = (img.larghezza as usize, img.altezza as usize);
    let passo = ((w.min(h) / 8).max(1)) as usize;
    let mut somma = [0f32; 3];
    let mut quanti = 0f32;
    let mut y = y0;
    while y < (y0 + h).min(ih) {
        let mut x = x0;
        while x < (x0 + w).min(iw) {
            let i = (y * iw + x) * 3;
            if let Some(p) = img.pixel.get(i..i + 3) {
                somma[0] += p[0] as f32;
                somma[1] += p[1] as f32;
                somma[2] += p[2] as f32;
                quanti += 1.0;
            }
            x += passo;
        }
        y += passo;
    }
    if quanti == 0.0 {
        return [0.0; 3];
    }
    [somma[0] / quanti, somma[1] / quanti, somma[2] / quanti]
}

pub fn firma(img: &Immagine) -> Firma {
    Firma {
        struttura: struttura(img),
        colore: colore(img),
        nitidezza: nitidezza(img),
    }
}

/// dHash: si confronta ogni pixel col suo vicino di destra su una griglia 9×8.
/// Confrontare vicini invece di una soglia assoluta e' cio' che rende l'impronta
/// indifferente a un cambio di esposizione.
pub fn struttura(img: &Immagine) -> u64 {
    let (iw, ih) = (img.larghezza as usize, img.altezza as usize);
    if iw < 2 || ih < 2 {
        return 0;
    }
    let mut bit = 0u64;
    let mut n = 0;
    for r in 0..LATO_DHASH {
        let y = r * ih / LATO_DHASH + ih / (LATO_DHASH * 2);
        let y = y.min(ih - 1);
        let mut precedente = grigio(img, 0, y);
        for c in 1..=LATO_DHASH {
            let x = (c * iw / (LATO_DHASH + 1)).min(iw - 1);
            let attuale = grigio(img, x, y);
            if attuale > precedente {
                bit |= 1 << n;
            }
            precedente = attuale;
            n += 1;
        }
    }
    bit
}

/// Colore dei riquadri, meno la media generale. Il centraggio serve a non leggere
/// come «scena diversa» la stessa scena con mezzo stop in meno.
pub fn colore(img: &Immagine) -> [i16; LATO_COLORE * LATO_COLORE * 3] {
    let (iw, ih) = (img.larghezza as usize, img.altezza as usize);
    let mut grezzo = [[0f32; 3]; LATO_COLORE * LATO_COLORE];
    let (pw, ph) = ((iw / LATO_COLORE).max(1), (ih / LATO_COLORE).max(1));

    for ry in 0..LATO_COLORE {
        for rx in 0..LATO_COLORE {
            grezzo[ry * LATO_COLORE + rx] = media_riquadro(img, rx * pw, ry * ph, pw, ph);
        }
    }
    let mut medio = [0f32; 3];
    for r in &grezzo {
        for k in 0..3 {
            medio[k] += r[k];
        }
    }
    for k in 0..3 {
        medio[k] /= grezzo.len() as f32;
    }

    let mut fuori = [0i16; LATO_COLORE * LATO_COLORE * 3];
    for (i, r) in grezzo.iter().enumerate() {
        for k in 0..3 {
            fuori[i * 3 + k] = (r[k] - medio[k]).round() as i16;
        }
    }
    fuori
}

/// Energia dei bordi, normalizzata. Non e' una misura assoluta di nitidezza — una
/// scena piatta e a fuoco ne produce poca — ma fra due scatti della stessa raffica
/// dice quale dei due e' meno mosso, che e' l'unica domanda per cui serve.
pub fn nitidezza(img: &Immagine) -> f32 {
    let (iw, ih) = (img.larghezza as usize, img.altezza as usize);
    if iw < 3 || ih < 3 {
        return 0.0;
    }
    let passo = (iw.min(ih) / 128).max(1);
    let mut somma = 0f64;
    let mut quanti = 0f64;
    let mut y = 1;
    while y < ih - 1 {
        let mut x = 1;
        while x < iw - 1 {
            // Laplaciano a 4 vicini: risponde ai bordi in ogni direzione.
            let c = grigio(img, x, y) * 4.0
                - grigio(img, x - 1, y)
                - grigio(img, x + 1, y)
                - grigio(img, x, y - 1)
                - grigio(img, x, y + 1);
            somma += (c as f64) * (c as f64);
            quanti += 1.0;
            x += passo;
        }
        y += passo;
    }
    if quanti == 0.0 {
        return 0.0;
    }
    ((somma / quanti).sqrt() / 255.0) as f32
}

/// Quanti bit differiscono fra due impronte strutturali.
pub fn distanza_struttura(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Distanza fra due griglie di colore, come massimo scarto su un singolo canale.
/// Il massimo e non la media: una scena che cambia solo in un angolo resta una scena
/// diversa, e la media la nasconderebbe.
pub fn distanza_colore(a: &[i16], b: &[i16]) -> i16 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).max().unwrap_or(0)
}

#[cfg(test)]
mod prove {
    use super::*;

    fn tinta(w: u32, h: u32, r: u8, g: u8, b: u8) -> Immagine {
        let mut pixel = Vec::with_capacity((w * h * 3) as usize);
        for _ in 0..(w * h) {
            pixel.extend_from_slice(&[r, g, b]);
        }
        Immagine { larghezza: w, altezza: h, pixel }
    }

    fn scacchi(w: u32, h: u32, lato: u32) -> Immagine {
        let mut pixel = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                let v = if ((x / lato) + (y / lato)) % 2 == 0 { 240 } else { 15 };
                pixel.extend_from_slice(&[v, v, v]);
            }
        }
        Immagine { larghezza: w, altezza: h, pixel }
    }

    #[test]
    fn la_stessa_immagine_ha_la_stessa_firma() {
        let a = scacchi(128, 128, 16);
        assert_eq!(firma(&a), firma(&a));
    }

    #[test]
    fn due_immagini_diverse_hanno_struttura_diversa() {
        let a = struttura(&scacchi(128, 128, 16));
        let b = struttura(&scacchi(128, 128, 8));
        assert!(distanza_struttura(a, b) > 0, "due trame diverse devono distinguersi");
    }

    #[test]
    fn un_cambio_di_esposizione_non_cambia_la_struttura() {
        // La stessa scena, tutta piu' scura: il dHash confronta vicini, non soglie.
        let chiara = scacchi(128, 128, 16);
        let mut scura = chiara.clone();
        for p in scura.pixel.iter_mut() {
            *p = (*p as f32 * 0.6) as u8;
        }
        assert_eq!(struttura(&chiara), struttura(&scura));
    }

    #[test]
    fn una_tinta_piatta_e_meno_nitida_di_una_trama() {
        assert!(nitidezza(&scacchi(128, 128, 8)) > nitidezza(&tinta(128, 128, 128, 128, 128)));
    }

    #[test]
    fn il_colore_e_centrato_sulla_media() {
        // Una tinta uniforme ha scarto zero in ogni riquadro, qualunque sia la tinta.
        for v in [10u8, 128, 250] {
            let c = colore(&tinta(64, 64, v, v, v));
            assert!(c.iter().all(|x| x.abs() <= 1), "tinta {v}: scarto {c:?}");
        }
    }

    #[test]
    fn la_distanza_di_colore_e_il_massimo_non_la_media() {
        let a = [0i16; 48];
        let mut b = [0i16; 48];
        b[7] = 40; // un solo riquadro molto diverso
        assert_eq!(distanza_colore(&a, &b), 40);
    }

    #[test]
    fn immagini_degeneri_non_vanno_in_panico() {
        for (w, h) in [(0u32, 0u32), (1, 1), (2, 1), (1, 200)] {
            let i = tinta(w.max(1), h.max(1), 5, 5, 5);
            let _ = firma(&i);
        }
    }
}
