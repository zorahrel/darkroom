//! Il protocollo `anteprima://`, servito dal motore in questo stesso processo.
//!
//! E' l'unica differenza sostanziale fra l'applicazione e la versione web. Nel browser
//! un'anteprima e' una richiesta HTTP al backend, che chiama il motore e rimanda i
//! byte indietro; qui il motore e' gia' qui, e i byte non attraversano nessuna porta.
//! Su una griglia da duemila scatti sono duemila richieste che non partono.

use darkroom_core::{preview, Errore};
use std::path::Path;
use tauri::http::{Response, StatusCode};

pub fn errore(codice: StatusCode, testo: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(codice)
        .header("content-type", "text/plain; charset=utf-8")
        .body(testo.into_bytes())
        .unwrap()
}

/// Serve `anteprima://<livello>/<percorso>` leggendo il file e producendo il JPEG
/// **in questo processo**.
///
/// Il percorso e' un file locale, quindi va trattato come tale: si accettano solo
/// percorsi assoluti gia' esistenti, e non si costruisce niente concatenando pezzi
/// presi dall'URL.
pub fn servi_anteprima(uri: &str) -> Response<Vec<u8>> {
    let senza_schema = match uri.split_once("://") {
        Some((_, resto)) => resto,
        None => return errore(StatusCode::BAD_REQUEST, "URI senza schema".into()),
    };
    // Su alcune piattaforme Tauri riscrive lo schema in `<schema>.localhost`.
    let senza_host = senza_schema
        .strip_prefix("anteprima.localhost/")
        .or_else(|| senza_schema.strip_prefix("localhost/"))
        .unwrap_or(senza_schema);

    let (livello_nome, percorso_grezzo) = match senza_host.split_once('/') {
        Some(v) => v,
        None => return errore(StatusCode::BAD_REQUEST, "manca il livello".into()),
    };
    let livello = match preview::Livello::da_nome(livello_nome) {
        Some(l) => l,
        None => {
            return errore(
                StatusCode::BAD_REQUEST,
                format!("livello sconosciuto: {livello_nome}"),
            )
        }
    };
    let percorso = percent_decode(percorso_grezzo);
    let percorso = Path::new(&percorso);
    if !percorso.is_absolute() || !percorso.is_file() {
        return errore(
            StatusCode::NOT_FOUND,
            format!("non e' un file: {}", percorso.display()),
        );
    }

    let esito = preview::anteprima(percorso, livello)
        .and_then(|a| preview::in_jpeg(&a.immagine, 82));
    match esito {
        Ok(jpeg) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "image/jpeg")
            // Il contenuto di un file non cambia sotto lo stesso percorso senza che
            // cambi anche la sua data: la cache del webview puo' tenerselo.
            .header("cache-control", "private, max-age=3600")
            .body(jpeg)
            .unwrap(),
        Err(e) => {
            let codice = match e {
                Errore::NonLeggibile { .. } => StatusCode::NOT_FOUND,
                Errore::NonTiff { .. } | Errore::SenzaAnteprima { .. } => {
                    StatusCode::UNSUPPORTED_MEDIA_TYPE
                }
                _ => StatusCode::UNPROCESSABLE_ENTITY,
            };
            errore(codice, e.to_string())
        }
    }
}

/// Decodifica `%XX` di un URL. Non si usa una libreria per tre righe.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut fuori = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                fuori.push(v);
                i += 3;
                continue;
            }
        }
        fuori.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&fuori).into_owned()
}


#[cfg(test)]
mod prove {
    use super::*;
    use std::io::Write;

    /// Un JPEG vero, minuscolo: le prove devono percorrere il decodificatore, non
    /// aggirarlo con un file finto che nessuno legge davvero.
    const JPEG: &[u8] = include_bytes!("../prove/piccola.jpg");

    fn scrivi(nome: &str, dati: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("darkroom-app-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(nome);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(dati).unwrap();
        p
    }

    fn chiedi(livello: &str, percorso: &Path) -> Response<Vec<u8>> {
        let codificato: String = percorso
            .to_string_lossy()
            .chars()
            .map(|c| match c {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
                altro => altro
                    .to_string()
                    .into_bytes()
                    .iter()
                    .map(|b| format!("%{b:02X}"))
                    .collect(),
            })
            .collect();
        servi_anteprima(&format!("anteprima://{livello}/{codificato}"))
    }

    #[test]
    fn un_file_vero_torna_come_jpeg() {
        let p = scrivi("buona.jpg", JPEG);
        let r = chiedi("griglia", &p);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()["content-type"], "image/jpeg");
        // I byte sono un JPEG, non un messaggio d'errore travestito.
        assert_eq!(&r.body()[0..2], &[0xFF, 0xD8]);
        assert_eq!(&r.body()[r.body().len() - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn i_quattro_livelli_rispondono_tutti() {
        let p = scrivi("livelli.jpg", JPEG);
        for l in ["proxy", "griglia", "visore", "nativo"] {
            assert_eq!(chiedi(l, &p).status(), StatusCode::OK, "livello {l}");
        }
    }

    #[test]
    fn un_livello_inventato_e_una_richiesta_sbagliata() {
        // Le prove girano in parallelo: riscrivere livelli.jpg poteva svuotarlo
        // mentre la prova dei quattro livelli lo leggeva, producendo un falso 415.
        let p = scrivi("livello-inventato.jpg", JPEG);
        assert_eq!(chiedi("enorme", &p).status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn un_file_che_non_esiste_non_e_trovato() {
        let r = chiedi("griglia", Path::new("/non/esiste/mai.ARW"));
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn un_percorso_relativo_viene_rifiutato_anche_quando_esiste() {
        // `prove/piccola.jpg` esiste davvero rispetto alla cartella di lavoro delle
        // prove: se il controllo guardasse solo "e' un file", questo passerebbe.
        // Un percorso relativo si risolve contro la cartella di lavoro del processo,
        // che non e' una cosa che l'interfaccia debba poter scegliere.
        assert!(Path::new("prove/piccola.jpg").is_file(), "la prova non prova niente");
        let r = servi_anteprima("anteprima://griglia/prove%2Fpiccola.jpg");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn una_cartella_non_e_una_fotografia() {
        let r = chiedi("griglia", &std::env::temp_dir());
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn un_file_che_non_e_una_fotografia_lo_dice() {
        let p = scrivi("non_foto.txt", b"questo non e' un JPEG");
        let r = chiedi("griglia", &p);
        assert_eq!(r.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn lo_schema_riscritto_dalle_piattaforme_si_capisce_lo_stesso() {
        // Su alcune piattaforme il webview presenta l'URI come
        // `anteprima://anteprima.localhost/<...>`: se non lo si riconosce, l'app
        // funziona su un sistema e non sull'altro.
        let p = scrivi("host.jpg", JPEG);
        let percorso = p.to_string_lossy().replace('/', "%2F");
        let r = servi_anteprima(&format!("anteprima://anteprima.localhost/griglia/{percorso}"));
        assert_eq!(r.status(), StatusCode::OK);
    }

    #[test]
    fn un_uri_senza_niente_dentro_non_va_in_panico() {
        for u in ["anteprima://", "anteprima://griglia", "senza-schema", ""] {
            let _ = servi_anteprima(u);
        }
    }

    #[test]
    fn la_decodifica_percentuale_regge_i_casi_storti() {
        assert_eq!(percent_decode("a%2Fb"), "a/b");
        assert_eq!(percent_decode("Citt%C3%A0"), "Città");
        // Una sequenza monca resta com'e' invece di far cadere tutto.
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%ZZb"), "a%ZZb");
    }
}
