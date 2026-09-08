//! Il motore, visto da fuori.
//!
//! Due modi di parlarci, la stessa logica dietro entrambi:
//!
//! - **servizio**: righe JSON su stdin, una risposta JSON per riga su stdout. E' come
//!   lo chiama il backend Bun — un processo solo, vivo, che non paga l'avvio a ogni foto.
//!   Pagare l'avvio a ogni foto e' precisamente il difetto da 1859 ms che stiamo togliendo.
//! - **comando**: un'operazione e via, per gli script e per guardare cosa succede a mano.

use darkroom_core::{cache, decode, preview, signature, Errore, Risultato};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Richiesta {
    /// Sono vivo?
    Ping,
    /// Che formati so indicizzare.
    Formati,
    /// Un'anteprima a un livello, scritta come JPEG.
    Anteprima {
        file: String,
        livello: String,
        uscita: String,
        #[serde(default = "qualita_predefinita")]
        qualita: u8,
        /// Se l'anteprima incorporata non basta, decodificare il RAW.
        /// Costa da mezzo secondo a un secondo e mezzo: non si fa di nascosto.
        #[serde(default)]
        consenti_decodifica: bool,
    },
    /// Cosa si puo' sapere del file senza decodificarlo.
    Diagnosi { file: String },
    /// La firma percettiva, per il raggruppamento delle raffiche.
    Firma { file: String },
}

fn qualita_predefinita() -> u8 {
    82
}

#[derive(Serialize)]
#[serde(untagged)]
enum Risposta {
    Ok(serde_json::Value),
    Errore { errore: String, codice: String, file: String },
}

impl From<Errore> for Risposta {
    fn from(e: Errore) -> Self {
        Risposta::Errore {
            errore: e.to_string(),
            codice: e.codice().to_string(),
            file: e.file().to_string(),
        }
    }
}

fn livello_da(nome: &str) -> Risultato<preview::Livello> {
    preview::Livello::da_nome(nome).ok_or_else(|| Errore::Malformato {
        file: nome.to_string(),
        dettaglio: format!("livello sconosciuto: {nome}"),
    })
}

/// Produce l'anteprima e la scrive. Quando l'incorporata non arriva al livello
/// richiesto lo dichiara: `troncata` nella risposta e' il segnale che chi disegna
/// sta guardando pixel interpolati.
fn fai_anteprima(
    file: &str,
    livello: &str,
    uscita: &str,
    qualita: u8,
    consenti_decodifica: bool,
) -> Risultato<serde_json::Value> {
    let percorso = Path::new(file);
    let liv = livello_da(livello)?;
    let inizio = Instant::now();

    let mut a = preview::anteprima(percorso, liv)?;
    let mut decodificata = false;

    if a.troncata && consenti_decodifica {
        if let Some(richiesto) = liv.lato_lungo() {
            // Il lato del sensore serve a scegliere fra meta' risoluzione e piena:
            // e' un conto, non una preferenza.
            let lato_sensore = preview::diagnosi(percorso).ok().and_then(|d| d.lato_lungo_scatto);
            match decode::piena_per_lato(percorso, richiesto, lato_sensore) {
                Ok(piena) => {
                    let ridotta = preview::riduci(piena, richiesto)?;
                    let troncata = ridotta.lato_lungo() < richiesto;
                    a = preview::Anteprima {
                        immagine: ridotta,
                        da_incorporata: false,
                        troncata,
                    };
                    decodificata = true;
                }
                // Se la decodifica piena non riesce si tiene l'anteprima piccola:
                // qualcosa da mostrare e' meglio di una casella vuota, purche' sia
                // dichiarato che e' piu' piccola del richiesto.
                Err(_) => {}
            }
        }
    }

    let jpeg = preview::in_jpeg(&a.immagine, qualita)?;
    if let Some(genitore) = Path::new(uscita).parent() {
        std::fs::create_dir_all(genitore).map_err(|e| Errore::Scrittura {
            file: uscita.to_string(),
            causa: e.to_string(),
        })?;
    }
    // Si scrive accanto e si rinomina: chi legge trova il file vecchio o quello nuovo,
    // mai uno a meta'.
    let temporaneo = format!("{uscita}.parziale");
    std::fs::write(&temporaneo, &jpeg).map_err(|e| Errore::Scrittura {
        file: temporaneo.clone(),
        causa: e.to_string(),
    })?;
    std::fs::rename(&temporaneo, uscita).map_err(|e| Errore::Scrittura {
        file: uscita.to_string(),
        causa: e.to_string(),
    })?;

    Ok(serde_json::json!({
        "file": file,
        "uscita": uscita,
        "livello": liv.nome(),
        "larghezza": a.immagine.larghezza,
        "altezza": a.immagine.altezza,
        "da_incorporata": a.da_incorporata,
        "decodificata": decodificata,
        "troncata": a.troncata,
        "byte": jpeg.len(),
        "ms": inizio.elapsed().as_secs_f64() * 1000.0,
    }))
}

fn fai_diagnosi(file: &str) -> Risultato<serde_json::Value> {
    let d = preview::diagnosi(Path::new(file))?;
    Ok(serde_json::json!({
        "file": d.file,
        "byte_file": d.byte_file,
        "lato_lungo_incorporata": d.lato_lungo_incorporata,
        "lato_lungo_scatto": d.lato_lungo_scatto,
        "orientamento": d.orientamento,
        "anteprime_trovate": d.anteprime_trovate,
        "livelli_serviti": d.livelli_serviti,
        "decodifica_piena_disponibile": decode::disponibile(),
    }))
}

fn fai_firma(file: &str) -> Risultato<serde_json::Value> {
    // La firma si calcola sul livello griglia: piu' fine non cambia il raggruppamento
    // e costa di piu'.
    let a = preview::anteprima(Path::new(file), preview::Livello::Griglia)?;
    let f = signature::firma(&a.immagine);
    Ok(serde_json::json!({
        "file": file,
        "struttura": f.struttura.to_string(),
        "colore": f.colore.to_vec(),
        "nitidezza": f.nitidezza,
    }))
}

fn esegui(r: Richiesta) -> Risposta {
    let esito = match r {
        Richiesta::Ping => Ok(serde_json::json!({
            "vivo": true,
            "versione": env!("CARGO_PKG_VERSION"),
            "decodifica_piena": decode::disponibile(),
            "budget_cache_byte": cache::budget_totale(memoria_fisica()),
        })),
        Richiesta::Formati => Ok(serde_json::json!({
            "raw": ["nef","nrw","cr2","cr3","crw","arw","srf","sr2","dng","raf",
                    "orf","rw2","raw","pef","iiq","3fr","erf","mos","mrw","x3f","gpr"],
            "altri": ["jpg","jpeg","jpe","png","heic","heif","tif","tiff","webp"],
        })),
        Richiesta::Anteprima { file, livello, uscita, qualita, consenti_decodifica } => {
            fai_anteprima(&file, &livello, &uscita, qualita, consenti_decodifica)
        }
        Richiesta::Diagnosi { file } => fai_diagnosi(&file),
        Richiesta::Firma { file } => fai_firma(&file),
    };
    match esito {
        Ok(v) => Risposta::Ok(v),
        Err(e) => e.into(),
    }
}

/// Memoria fisica della macchina. Se non si riesce a saperlo si assumono 8 GB:
/// sbagliare in difetto rende la cache piccola, non instabile.
fn memoria_fisica() -> u64 {
    #[cfg(target_os = "macos")]
    {
        if let Ok(u) = std::process::Command::new("/usr/sbin/sysctl").arg("-n").arg("hw.memsize").output() {
            if let Ok(s) = String::from_utf8(u.stdout) {
                if let Ok(v) = s.trim().parse::<u64>() {
                    return v;
                }
            }
        }
    }
    8 * 1024 * 1024 * 1024
}

/// Modo servizio: una riga entra, una riga esce. Una riga illeggibile produce un
/// errore e non ferma il servizio — chi ci parla ha decine di migliaia di foto da
/// mandare, e non deve ricominciare per una riga storta.
fn servizio() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for riga in stdin.lock().lines() {
        let riga = match riga {
            Ok(r) => r,
            Err(_) => break,
        };
        if riga.trim().is_empty() {
            continue;
        }
        let risposta = match serde_json::from_str::<Richiesta>(&riga) {
            Ok(r) => esegui(r),
            Err(e) => Risposta::Errore {
                errore: format!("richiesta illeggibile: {e}"),
                codice: "richiesta_illeggibile".into(),
                file: String::new(),
            },
        };
        let _ = writeln!(stdout, "{}", serde_json::to_string(&risposta).unwrap_or_default());
        let _ = stdout.flush();
    }
}

fn stampa(v: &Risposta) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

/// Misura una cartella: e' il comando da eseguire prima di credere a una soglia.
/// Riporta la dimensione dell'anteprima incorporata **prima** dei tempi, perche' e'
/// quel numero a decidere quanto costa ogni livello, e cambia da fotocamera a fotocamera.
fn misura(cartella: &str, livello: preview::Livello) {
    let mut file: Vec<PathBuf> = match std::fs::read_dir(cartella) {
        Ok(d) => d
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| darkroom_core::e_raw(e))
                    .unwrap_or(false)
            })
            .collect(),
        Err(e) => {
            eprintln!("{cartella}: {e}");
            std::process::exit(1);
        }
    };
    file.sort();
    if file.is_empty() {
        eprintln!("{cartella}: nessun RAW");
        std::process::exit(1);
    }

    // Prima il numero che decide tutto il resto.
    match preview::diagnosi(&file[0]) {
        Ok(d) => {
            println!("anteprima incorporata: {} px sul lato lungo", d.lato_lungo_incorporata);
            println!("scatto intero:         {:?} px", d.lato_lungo_scatto);
            println!("livelli serviti senza decodifica: {}", d.livelli_serviti.join(", "));
        }
        Err(e) => println!("diagnosi non riuscita: {e}"),
    }

    let compilazione = if cfg!(debug_assertions) { "sviluppo" } else { "rilascio" };
    println!("compilazione: {compilazione}");
    if cfg!(debug_assertions) {
        println!("ATTENZIONE: i numeri di una build di sviluppo non valgono come misura.");
    }

    let inizio = Instant::now();
    let mut riusciti = 0usize;
    for f in &file {
        if preview::anteprima(f, livello).is_ok() {
            riusciti += 1;
        }
    }
    let ms = inizio.elapsed().as_secs_f64() * 1000.0;
    println!(
        "\nseriale  {}: {riusciti}/{} file, {ms:.0} ms, {:.1} ms/foto",
        livello.nome(),
        file.len(),
        ms / file.len() as f64
    );

    use rayon::prelude::*;
    let inizio = Instant::now();
    let riusciti: usize = file
        .par_iter()
        .map(|f| usize::from(preview::anteprima(f, livello).is_ok()))
        .sum();
    let ms = inizio.elapsed().as_secs_f64() * 1000.0;
    println!(
        "parallelo {}: {riusciti}/{} file, {ms:.0} ms, {:.1} ms/foto",
        livello.nome(),
        file.len(),
        ms / file.len() as f64
    );
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(|s| s.as_str()) {
        None | Some("servizio") => servizio(),
        Some("diagnosi") => match a.get(2) {
            Some(f) => stampa(&match fai_diagnosi(f) {
                Ok(v) => Risposta::Ok(v),
                Err(e) => e.into(),
            }),
            None => eprintln!("uso: darkroom-core diagnosi <file>"),
        },
        Some("firma") => match a.get(2) {
            Some(f) => stampa(&match fai_firma(f) {
                Ok(v) => Risposta::Ok(v),
                Err(e) => e.into(),
            }),
            None => eprintln!("uso: darkroom-core firma <file>"),
        },
        Some("anteprima") => match (a.get(2), a.get(3), a.get(4)) {
            (Some(f), Some(l), Some(u)) => stampa(&match fai_anteprima(f, l, u, 82, true) {
                Ok(v) => Risposta::Ok(v),
                Err(e) => e.into(),
            }),
            _ => eprintln!("uso: darkroom-core anteprima <file> <livello> <uscita.jpg>"),
        },
        Some("misura") => {
            let cartella = a.get(2).cloned().unwrap_or_else(|| ".".into());
            let livello = a
                .get(3)
                .and_then(|s| preview::Livello::da_nome(s))
                .unwrap_or(preview::Livello::Griglia);
            misura(&cartella, livello);
        }
        Some(altro) => {
            eprintln!("comando sconosciuto: {altro}");
            eprintln!("uso: darkroom-core [servizio|diagnosi|firma|anteprima|misura]");
            std::process::exit(2);
        }
    }
}
