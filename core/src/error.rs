use std::fmt;

/// Ogni modo in cui un file puo' rifiutarsi di essere letto.
///
/// Sono varianti distinte e non un messaggio unico perche' chi chiama deve poter
/// distinguere «questo file non lo so leggere» da «questo file e' rotto»: il primo
/// caso e' una funzionalita' mancante, il secondo e' una notizia per l'utente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Errore {
    /// Il file non si apre o non si mappa in memoria.
    NonLeggibile { file: String, causa: String },
    /// Non e' un contenitore TIFF: intestazione assente o incoerente.
    NonTiff { file: String },
    /// E' un TIFF ma non contiene nessuna anteprima utilizzabile.
    SenzaAnteprima { file: String },
    /// Struttura interna incoerente: offset fuori dai limiti, IFD ciclico, campo troncato.
    Malformato { file: String, dettaglio: String },
    /// L'anteprima esiste ma il decodificatore JPEG la rifiuta.
    JpegIllegibile { file: String, causa: String },
    /// La decodifica piena, che gira in un processo separato, non ha prodotto un'immagine.
    DecodificaFallita { file: String, causa: String },
    /// Errore in scrittura sul disco.
    Scrittura { file: String, causa: String },
}

impl Errore {
    /// Il file a cui l'errore si riferisce. Un errore che non nomina il file
    /// costringe chi legge il log a indovinare quale scatto saltare.
    pub fn file(&self) -> &str {
        match self {
            Errore::NonLeggibile { file, .. }
            | Errore::NonTiff { file }
            | Errore::SenzaAnteprima { file }
            | Errore::Malformato { file, .. }
            | Errore::JpegIllegibile { file, .. }
            | Errore::DecodificaFallita { file, .. }
            | Errore::Scrittura { file, .. } => file,
        }
    }

    /// Codice stabile, pensato per essere confrontato da chi ci chiama.
    pub fn codice(&self) -> &'static str {
        match self {
            Errore::NonLeggibile { .. } => "non_leggibile",
            Errore::NonTiff { .. } => "non_tiff",
            Errore::SenzaAnteprima { .. } => "senza_anteprima",
            Errore::Malformato { .. } => "malformato",
            Errore::JpegIllegibile { .. } => "jpeg_illeggibile",
            Errore::DecodificaFallita { .. } => "decodifica_fallita",
            Errore::Scrittura { .. } => "scrittura",
        }
    }
}

impl fmt::Display for Errore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Errore::NonLeggibile { file, causa } => write!(f, "{file}: non leggibile ({causa})"),
            Errore::NonTiff { file } => write!(f, "{file}: non e' un contenitore TIFF"),
            Errore::SenzaAnteprima { file } => {
                write!(f, "{file}: nessuna anteprima incorporata utilizzabile")
            }
            Errore::Malformato { file, dettaglio } => write!(f, "{file}: malformato ({dettaglio})"),
            Errore::JpegIllegibile { file, causa } => {
                write!(f, "{file}: anteprima illeggibile ({causa})")
            }
            Errore::DecodificaFallita { file, causa } => {
                write!(f, "{file}: decodifica piena fallita ({causa})")
            }
            Errore::Scrittura { file, causa } => write!(f, "{file}: scrittura fallita ({causa})"),
        }
    }
}

impl std::error::Error for Errore {}

pub type Risultato<T> = std::result::Result<T, Errore>;
