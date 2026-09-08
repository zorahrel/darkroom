// L'applicazione desktop di Darkroom.
//
// Non e' un secondo prodotto: e' lo **stesso** frontend della versione web dentro un
// guscio nativo. Una funzionalita' aggiunta all'interfaccia compare in entrambe senza
// essere scritta due volte, ed e' il motivo per cui qui dentro non c'e' nessuna vista.
//
// La differenza vera fra i due gusci sta in una cosa sola: **il percorso caldo**. Nel
// browser un'anteprima e' una richiesta HTTP al backend, che chiama il motore e
// rimanda i byte indietro. Qui il motore e' nello stesso processo, e i byte non
// attraversano nessuna porta. Su una griglia da duemila scatti sono duemila richieste
// che non partono.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anteprima;

use anteprima::servi_anteprima;
use darkroom_core::preview;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

/// Dove gira il backend. La stessa porta della versione web: l'app non e'
/// un'installazione separata, e' un'altra finestra sullo stesso lavoro.
const PORTA: u16 = 3535;

/// Il backend avviato da noi, se lo abbiamo avviato noi.
///
/// Se ne trova gia' uno in ascolto non se ne apre un secondo: due server sullo stesso
/// database sarebbero due code di lavori che non si vedono.
struct BackendNostro(Mutex<Option<Child>>);

/// La radice del progetto: quella che contiene `package.json` e `server/`.
///
/// Si sale dall'eseguibile finche' non la si trova. Darkroom e' uno strumento locale:
/// il progetto installato *e'* l'applicazione, e il guscio ci gira sopra invece di
/// portarselo dentro.
fn radice_progetto() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("DARKROOM_HOME") {
        let p = PathBuf::from(d);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..8 {
        if !dir.pop() {
            break;
        }
        if dir.join("package.json").exists() && dir.join("server").is_dir() {
            return Some(dir.clone());
        }
    }
    // In sviluppo si parte da `app/`, quindi la radice e' il genitore.
    let cwd = std::env::current_dir().ok()?;
    for candidato in [cwd.clone(), cwd.parent()?.to_path_buf()] {
        if candidato.join("package.json").exists() && candidato.join("server").is_dir() {
            return Some(candidato);
        }
    }
    None
}

fn backend_risponde() -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{PORTA}").parse().unwrap(),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

/// Avvia il backend, se non c'e' gia'.
fn avvia_backend() -> Option<Child> {
    if backend_risponde() {
        eprintln!("[darkroom] backend gia' in ascolto sulla {PORTA}: non ne apro un altro");
        return None;
    }
    let radice = radice_progetto()?;
    eprintln!("[darkroom] avvio il backend da {}", radice.display());
    // `bun` dal PATH: Darkroom lo richiede gia' per la versione web, quindi non e'
    // una dipendenza in piu' -- e' la stessa.
    Command::new("bun")
        .arg("run")
        .arg("server/index.ts")
        .current_dir(&radice)
        .env("PORT", PORTA.to_string())
        .spawn()
        .map_err(|e| eprintln!("[darkroom] bun non si avvia: {e}"))
        .ok()
}

/// Aspetta che il backend risponda, per non mostrare una finestra su una pagina morta.
fn attendi_backend(secondi: u64) -> bool {
    let scadenza = std::time::Instant::now() + std::time::Duration::from_secs(secondi);
    while std::time::Instant::now() < scadenza {
        if backend_risponde() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    false
}

/// Quello che il motore sa dire di un file senza decodificarlo.
/// Nell'app si chiede direttamente, senza passare dal backend.
#[tauri::command]
fn diagnosi(file: String) -> Result<serde_json::Value, String> {
    preview::diagnosi(Path::new(&file))
        .map(|d| {
            serde_json::json!({
                "file": d.file,
                "byteFile": d.byte_file,
                "latoLungoIncorporata": d.lato_lungo_incorporata,
                "latoLungoScatto": d.lato_lungo_scatto,
                "orientamento": d.orientamento,
                "anteprimeTrovate": d.anteprime_trovate,
                "livelliServiti": d.livelli_serviti,
            })
        })
        .map_err(|e| e.to_string())
}

/// Dice all'interfaccia che e' dentro l'app, e su quale porta parla il backend.
#[tauri::command]
fn ambiente() -> serde_json::Value {
    serde_json::json!({
        "guscio": "desktop",
        "porta": PORTA,
        "versione": env!("CARGO_PKG_VERSION"),
        "radice": radice_progetto().map(|p| p.to_string_lossy().into_owned()),
    })
}

fn main() {
    let figlio = avvia_backend();
    if !attendi_backend(20) {
        eprintln!("[darkroom] il backend non risponde: la finestra si aprira' comunque");
    }

    tauri::Builder::default()
        .manage(BackendNostro(Mutex::new(figlio)))
        .setup(|app| {
            // La finestra si costruisce qui e non nella configurazione perche' solo
            // cosi' si puo' iniettare uno script **prima** che la pagina carichi.
            //
            // Serve perche' l'interfaccia deve sapere di essere dentro
            // l'applicazione gia' al primo disegno: e' lei a lasciare lo spazio per
            // i semafori, che senza barra del titolo stanno sopra il contenuto.
            // Indovinarlo da una variabile globale non basta -- quali variabili
            // esistano dipende dalla versione e dalla configurazione -- e sbagliare
            // non da' un errore, da' il nome dell'applicazione scritto sotto i tre
            // bottoni.
            let finestra = tauri::WebviewWindowBuilder::new(
                app,
                "principale",
                tauri::WebviewUrl::default(),
            )
            .title("Darkroom")
            .inner_size(1440.0, 900.0)
            .min_inner_size(900.0, 600.0)
            // Lo script gira a documento ancora vuoto: `document.documentElement`
            // li' non esiste, e scriverci sopra fallisce in silenzio -- e' esattamente
            // cosi' che il marcatore non arrivava mai e l'interfaccia si comportava da
            // browser. La variabile globale invece c'e' sempre; l'attributo si mette
            // appena il documento c'e', per chi preferisce leggerlo dal CSS.
            .initialization_script(
                r#"
                window.__DARKROOM_GUSCIO__ = 'desktop';
                (function () {
                  function marca() {
                    try { document.documentElement.dataset.guscio = 'desktop'; } catch (e) {}
                  }
                  marca();
                  document.addEventListener('DOMContentLoaded', marca);
                })();
                "#,
            );

            #[cfg(target_os = "macos")]
            let finestra = finestra
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            finestra.build()?;
            Ok(())
        })
        .register_uri_scheme_protocol("anteprima", |_ctx, request| {
            servi_anteprima(&request.uri().to_string())
        })
        .invoke_handler(tauri::generate_handler![diagnosi, ambiente])
        .on_window_event(|finestra, evento| {
            if let tauri::WindowEvent::Destroyed = evento {
                // Il backend che abbiamo avviato noi si chiude con noi. Quello che
                // c'era gia' non si tocca: non e' nostro.
                if let Some(stato) = finestra.app_handle().try_state::<BackendNostro>() {
                    if let Ok(mut b) = stato.0.lock() {
                        if let Some(mut c) = b.take() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("l'applicazione non parte");
}
