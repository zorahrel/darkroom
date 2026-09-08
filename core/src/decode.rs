//! Decodifica piena del RAW, in un processo che si puo' perdere.
//!
//! Il decodificatore RAW e' l'unico pezzo di questa catena che puo' morire invece di
//! sbagliare: su un file corrotto termina il processo, e dall'intestazione non si puo'
//! prevedere quale file lo fara'. Per questo non gira mai qui dentro. Gira in un
//! sottoprocesso: se muore, muore lui, e chi stava facendo culling non perde niente.
//!
//! La stessa scelta chiude un difetto peggiore. A pipeline calda un decodificatore
//! riusato restituisce, su un file illeggibile, **l'immagine di prima** — stesso
//! soggetto, posa diversa — e non ha l'aspetto di un guasto: si giudica uno scatto
//! guardandone un altro. Un processo nuovo per ogni file non ha un'immagine di prima
//! da restituire.

use crate::error::{Errore, Risultato};
use crate::preview::Immagine;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Oltre questo tempo il sottoprocesso viene considerato bloccato e ucciso.
/// Una decodifica piena di un 42 megapixel misura 1,5 s: trenta secondi non e' una
/// soglia stretta, e' la differenza fra lento e fermo.
const ATTESA_MASSIMA: Duration = Duration::from_secs(30);

/// Dove cercare il decodificatore, in ordine.
fn eseguibile() -> Option<String> {
    if let Ok(p) = std::env::var("DARKROOM_DCRAW") {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }
    let candidati = [
        "/opt/homebrew/opt/libraw/bin/dcraw_emu",
        "/usr/local/opt/libraw/bin/dcraw_emu",
        "/usr/bin/dcraw_emu",
        "/usr/local/bin/dcraw_emu",
    ];
    candidati.iter().find(|p| Path::new(p).exists()).map(|p| p.to_string())
}

/// Vero se la decodifica piena e' disponibile su questa macchina.
pub fn disponibile() -> bool {
    eseguibile().is_some()
}

/// Decodifica il RAW e restituisce i pixel.
///
/// `meta_risoluzione` dimezza il lato in cambio di circa un terzo del tempo: si usa
/// quando la meta' basta gia' a coprire il lato richiesto. Sceglierlo o no non e' una
/// preferenza ma un conto, e lo fa `piena_per_lato`.
pub fn piena(percorso: &Path, meta_risoluzione: bool) -> Risultato<Immagine> {
    let nome = percorso.to_string_lossy().into_owned();
    let bin = eseguibile().ok_or_else(|| Errore::DecodificaFallita {
        file: nome.clone(),
        causa: "decodificatore RAW non installato (serve libraw)".into(),
    })?;

    let mut cmd = Command::new(&bin);
    cmd.arg("-w") // bilanciamento del bianco della fotocamera
        .arg("-q")
        .arg("0") // interpolazione veloce: qui si guarda, non si consegna
        .arg("-Z")
        .arg("-"); // su stdout, cosi' accanto agli originali non finisce niente
    if meta_risoluzione {
        cmd.arg("-h");
    }
    cmd.arg(percorso);

    let mut figlio = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Errore::DecodificaFallita { file: nome.clone(), causa: e.to_string() })?;

    let mut uscita = figlio.stdout.take().ok_or_else(|| Errore::DecodificaFallita {
        file: nome.clone(),
        causa: "nessuna uscita dal decodificatore".into(),
    })?;

    // Si legge in un filo separato, cosi' un sottoprocesso che non finisce mai non
    // blocca chi lo ha chiamato.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let esito = uscita.read_to_end(&mut buf).map(|_| buf);
        let _ = tx.send(esito);
    });

    let byte = match rx.recv_timeout(ATTESA_MASSIMA) {
        Ok(Ok(b)) => b,
        Ok(Err(e)) => {
            let _ = figlio.kill();
            return Err(Errore::DecodificaFallita { file: nome, causa: e.to_string() });
        }
        Err(_) => {
            let _ = figlio.kill();
            return Err(Errore::DecodificaFallita {
                file: nome,
                causa: format!("il decodificatore non ha risposto entro {ATTESA_MASSIMA:?}"),
            });
        }
    };

    let stato = figlio.wait().map_err(|e| Errore::DecodificaFallita {
        file: nome.clone(),
        causa: e.to_string(),
    })?;

    if !stato.success() || byte.is_empty() {
        let mut motivo = String::new();
        if let Some(mut e) = figlio.stderr.take() {
            let _ = e.read_to_string(&mut motivo);
        }
        let motivo = motivo.trim();
        return Err(Errore::DecodificaFallita {
            file: nome,
            causa: if motivo.is_empty() {
                format!("il decodificatore e' uscito con {stato}")
            } else {
                motivo.to_string()
            },
        });
    }

    leggi_ppm(&byte, &nome)
}

/// Sceglie il modo piu' economico che arriva al lato richiesto.
///
/// `lato_sensore` e' il lato lungo dello scatto intero: se la meta' di quel numero
/// copre gia' quello che serve, la meta' basta e costa un terzo.
pub fn piena_per_lato(percorso: &Path, lato_richiesto: u32, lato_sensore: Option<u32>) -> Risultato<Immagine> {
    let meta_basta = lato_sensore.map(|l| l / 2 >= lato_richiesto).unwrap_or(false);
    piena(percorso, meta_basta)
}

/// Legge un PPM binario (P6). E' il formato piu' semplice che il decodificatore sa
/// scrivere, ed e' il motivo per cui si usa: nessun parser di formato in mezzo.
fn leggi_ppm(byte: &[u8], nome: &str) -> Risultato<Immagine> {
    let errore = |dettaglio: &str| Errore::DecodificaFallita {
        file: nome.to_string(),
        causa: format!("PPM illeggibile: {dettaglio}"),
    };

    if byte.len() < 2 || &byte[0..2] != b"P6" {
        return Err(errore("firma P6 assente"));
    }

    let mut pos = 2usize;
    let mut campi: Vec<u32> = Vec::with_capacity(3);
    while campi.len() < 3 {
        // Salta spazi e commenti.
        loop {
            match byte.get(pos) {
                Some(c) if c.is_ascii_whitespace() => pos += 1,
                Some(b'#') => {
                    while matches!(byte.get(pos), Some(c) if *c != b'\n') {
                        pos += 1;
                    }
                }
                Some(_) => break,
                None => return Err(errore("intestazione troncata")),
            }
        }
        let inizio = pos;
        while matches!(byte.get(pos), Some(c) if c.is_ascii_digit()) {
            pos += 1;
        }
        if inizio == pos {
            return Err(errore("numero atteso nell'intestazione"));
        }
        let s = std::str::from_utf8(&byte[inizio..pos]).map_err(|_| errore("numero non ASCII"))?;
        campi.push(s.parse::<u32>().map_err(|_| errore("numero fuori scala"))?);
    }
    pos += 1; // il singolo separatore dopo il valore massimo

    let (larghezza, altezza, massimo) = (campi[0], campi[1], campi[2]);
    if larghezza == 0 || altezza == 0 {
        return Err(errore("dimensioni nulle"));
    }
    if massimo != 255 {
        return Err(errore("sono attesi 8 bit per canale"));
    }

    let attesi = larghezza as usize * altezza as usize * 3;
    let corpo = byte.get(pos..pos + attesi).ok_or_else(|| {
        errore(&format!("{} byte di immagine per {attesi} attesi", byte.len().saturating_sub(pos)))
    })?;

    Ok(Immagine { larghezza, altezza, pixel: corpo.to_vec() })
}

#[cfg(test)]
mod prove {
    use super::*;

    fn ppm(w: u32, h: u32, commento: bool) -> Vec<u8> {
        let mut b = Vec::new();
        if commento {
            b.extend_from_slice(format!("P6\n# scritto da una prova\n{w} {h}\n255\n").as_bytes());
        } else {
            b.extend_from_slice(format!("P6\n{w} {h}\n255\n").as_bytes());
        }
        b.extend(std::iter::repeat(7u8).take((w * h * 3) as usize));
        b
    }

    #[test]
    fn un_ppm_valido_si_legge() {
        let i = leggi_ppm(&ppm(4, 3, false), "prova").unwrap();
        assert_eq!((i.larghezza, i.altezza), (4, 3));
        assert_eq!(i.pixel.len(), 36);
    }

    #[test]
    fn i_commenti_nell_intestazione_non_disturbano() {
        let i = leggi_ppm(&ppm(2, 2, true), "prova").unwrap();
        assert_eq!((i.larghezza, i.altezza), (2, 2));
    }

    #[test]
    fn una_firma_sbagliata_e_un_errore() {
        assert!(leggi_ppm(b"P3\n1 1\n255\n\0\0\0", "prova").is_err());
        assert!(leggi_ppm(b"", "prova").is_err());
    }

    #[test]
    fn un_corpo_troncato_non_legge_fuori() {
        let mut b = ppm(10, 10, false);
        b.truncate(b.len() - 50);
        let e = leggi_ppm(&b, "troncato").unwrap_err();
        assert_eq!(e.codice(), "decodifica_fallita");
    }

    #[test]
    fn un_intestazione_troncata_non_va_in_panico() {
        for taglio in 0..12 {
            let b = ppm(4, 4, false);
            let _ = leggi_ppm(&b[..taglio.min(b.len())], "corto");
        }
    }

    #[test]
    fn dimensioni_nulle_sono_un_errore() {
        assert!(leggi_ppm(b"P6\n0 0\n255\n", "vuoto").is_err());
    }

    #[test]
    fn un_file_che_non_esiste_fallisce_senza_uccidere_nessuno() {
        if !disponibile() {
            return; // senza libraw questa prova non dice niente
        }
        let e = piena(Path::new("/non/esiste/mai.ARW"), true).unwrap_err();
        assert_eq!(e.codice(), "decodifica_fallita");
    }

    #[test]
    fn meta_risoluzione_si_sceglie_col_conto_non_a_gusto() {
        // Un sensore da 8000 px: la meta' copre 3840.
        assert!(8000u32 / 2 >= 3840);
        // Un sensore da 6000 px: la meta' non ci arriva, serve la piena.
        assert!(6000u32 / 2 < 3840);
    }
}
