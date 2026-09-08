//! Il motore locale di Darkroom.
//!
//! Non sa cosa siano HTTP, finestre o database: espone funzioni. Chi lo chiama decide
//! se farlo attraverso una porta (la versione web, dal backend Bun) o dentro il proprio
//! processo (l'applicazione desktop). E' l'unico modo per cui le due superfici sono la
//! stessa cosa e non due cose che si somigliano.
//!
//! Nessuna API specifica di un sistema operativo entra qui dentro: e' il vincolo che
//! rende Darkroom eseguibile fuori da macOS.

pub mod cache;
pub mod decode;
pub mod error;
pub mod preview;
pub mod signature;
pub mod tiff;

pub use error::{Errore, Risultato};
pub use preview::{Immagine, Livello};

/// Le estensioni che Darkroom sa indicizzare, con la famiglia a cui appartengono.
///
/// La lista e' qui e non nel backend perche' la conoscenza di cosa sia un RAW appartiene
/// al motore: due liste che devono restare uguali diventano diverse.
pub fn famiglia(estensione: &str) -> Option<&'static str> {
    let e = estensione.trim_start_matches('.').to_ascii_lowercase();
    Some(match e.as_str() {
        "nef" | "nrw" | "cr2" | "cr3" | "crw" | "arw" | "srf" | "sr2" | "dng" | "raf" | "orf"
        | "rw2" | "raw" | "pef" | "iiq" | "3fr" | "erf" | "mos" | "mrw" | "x3f" | "gpr" => "raw",
        "jpg" | "jpeg" | "jpe" => "jpeg",
        "png" => "png",
        "heic" | "heif" => "heic",
        "tif" | "tiff" => "tiff",
        "webp" => "webp",
        _ => return None,
    })
}

pub fn e_raw(estensione: &str) -> bool {
    famiglia(estensione) == Some("raw")
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn i_raw_dei_corpi_diffusi_sono_riconosciuti() {
        for e in ["NEF", ".nef", "cr2", "CR3", "arw", "dng", "raf", "orf", "rw2"] {
            assert!(e_raw(e), "{e} dovrebbe essere un RAW");
        }
    }

    #[test]
    fn i_formati_gia_supportati_restano_riconosciuti() {
        assert_eq!(famiglia("jpg"), Some("jpeg"));
        assert_eq!(famiglia(".JPEG"), Some("jpeg"));
        assert_eq!(famiglia("png"), Some("png"));
    }

    #[test]
    fn un_jpeg_non_e_un_raw() {
        assert!(!e_raw("jpg"));
        assert!(!e_raw("png"));
    }

    #[test]
    fn cio_che_non_e_una_fotografia_non_ha_famiglia() {
        for e in ["txt", "mov", "xmp", "", "doc"] {
            assert_eq!(famiglia(e), None, "{e} non e' una fotografia");
        }
    }
}
