//! I sidecar XMP: le scelte escono di qui verso il programma con cui si sviluppa.
//!
//! Due regole governano tutto questo file, e nessuna delle due e' prudenza generica.
//!
//! **Non si riscrive l'intero documento.** Un XMP scritto da Lightroom contiene lo
//! sviluppo, i ritagli e la cronologia di chi ha lavorato prima: roba che non ci
//! appartiene e che riscrivere significa cancellare. Si tocca solo il campo che ci
//! riguarda, e il resto resta identico byte per byte.
//!
//! **Non si cerca nel file intero.** Gli stessi nomi di campo compaiono dentro le
//! cronologie di Camera Raw, decine di volte. Una ricerca testuale sull'intero
//! documento leggerebbe quelle e le riscriverebbe: si opera solo dentro
//! l'`rdf:Description` che dichiara il prefisso `xmp:`.

use crate::error::{Errore, Risultato};
use std::path::{Path, PathBuf};

/// Il vocabolario delle etichette colore.
///
/// Camera Raw non salva un colore: salva la **parola** che in quella lingua nomina il
/// colore, e la confronta con l'elenco della sua lingua. Scritta in inglese dentro
/// un'installazione italiana, l'etichetta semplicemente non compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vocabolario {
    Italiano,
    Inglese,
}

impl Vocabolario {
    pub fn da_nome(s: &str) -> Option<Vocabolario> {
        match s.to_ascii_lowercase().as_str() {
            "it" | "italiano" => Some(Vocabolario::Italiano),
            "en" | "inglese" | "english" => Some(Vocabolario::Inglese),
            _ => None,
        }
    }

    pub fn nome(self) -> &'static str {
        match self {
            Vocabolario::Italiano => "it",
            Vocabolario::Inglese => "en",
        }
    }

    /// Le cinque parole, nell'ordine dei cinque colori.
    pub fn parole(self) -> [&'static str; 5] {
        match self {
            Vocabolario::Italiano => ["Seleziona", "Secondo", "Approvato", "Da rivedere", "Da fare"],
            Vocabolario::Inglese => ["Select", "Second", "Approved", "Review", "To Do"],
        }
    }

    pub fn parola(self, colore: Colore) -> &'static str {
        self.parole()[colore as usize]
    }

    /// Riconosce un colore da qualunque vocabolario: un file arrivato da un'altra
    /// installazione va letto, non scartato.
    pub fn colore_da_parola(parola: &str) -> Option<Colore> {
        let p = parola.trim();
        for v in [Vocabolario::Italiano, Vocabolario::Inglese] {
            if let Some(i) = v.parole().iter().position(|w| w.eq_ignore_ascii_case(p)) {
                return Colore::da_indice(i);
            }
        }
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Colore {
    Rosso = 0,
    Giallo = 1,
    Verde = 2,
    Blu = 3,
    Viola = 4,
}

impl Colore {
    pub fn da_indice(i: usize) -> Option<Colore> {
        Some(match i {
            0 => Colore::Rosso,
            1 => Colore::Giallo,
            2 => Colore::Verde,
            3 => Colore::Blu,
            4 => Colore::Viola,
            _ => return None,
        })
    }

    pub fn nome(self) -> &'static str {
        ["rosso", "giallo", "verde", "blu", "viola"][self as usize]
    }

    pub fn da_nome(s: &str) -> Option<Colore> {
        ["rosso", "giallo", "verde", "blu", "viola"]
            .iter()
            .position(|n| n.eq_ignore_ascii_case(s.trim()))
            .and_then(Colore::da_indice)
    }
}

/// Cio' che Darkroom scrive in un sidecar. Nient'altro.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Giudizio {
    /// Da 0 a 5. `None` significa «non giudicata», che non e' «zero stelle».
    pub stelle: Option<u8>,
    pub colore: Option<Colore>,
}

/// Il percorso del sidecar di un file: stesso nome di base, estensione `.xmp`.
pub fn percorso_sidecar(originale: &Path) -> PathBuf {
    originale.with_extension("xmp")
}

/// Dove finiscono le copie di sicurezza, accanto ai file di lavoro.
pub fn cartella_backup(originale: &Path) -> PathBuf {
    originale
        .parent()
        .unwrap_or(Path::new("."))
        .join("Darkroom_XMP_Backup")
}

/// Estremi dell'`rdf:Description` che dichiara il prefisso `xmp:`.
/// Fuori da questo intervallo non si legge e non si scrive.
fn descrizione_nostra(testo: &str) -> Option<(usize, usize)> {
    let mut da = 0usize;
    while let Some(rel) = testo[da..].find("<rdf:Description") {
        let inizio = da + rel;
        // Fine del tag di apertura.
        let fine_apertura = match testo[inizio..].find('>') {
            Some(o) => inizio + o + 1,
            None => return None,
        };
        // Un elemento vuoto si chiude da solo.
        let auto_chiuso = testo[inizio..fine_apertura].trim_end().ends_with("/>");
        let fine = if auto_chiuso {
            fine_apertura
        } else {
            match testo[fine_apertura..].find("</rdf:Description>") {
                Some(o) => fine_apertura + o + "</rdf:Description>".len(),
                None => testo.len(),
            }
        };
        // Il prefisso puo' essere dichiarato qui o piu' su, nel nodo radice; in
        // quest'ultimo caso ci si accontenta di trovare i nostri campi dentro.
        let blocco = &testo[inizio..fine];
        if blocco.contains("xmlns:xmp=") || blocco.contains("xmp:Rating") || blocco.contains("xmp:Label") {
            return Some((inizio, fine));
        }
        da = fine.max(inizio + 1);
    }
    None
}

/// Legge il valore di un campo dentro un intervallo, come attributo o come elemento.
fn leggi_campo(blocco: &str, campo: &str) -> Option<String> {
    // Forma attributo: xmp:Rating="3"
    let attributo = format!("{campo}=\"");
    if let Some(o) = blocco.find(&attributo) {
        let da = o + attributo.len();
        if let Some(l) = blocco[da..].find('"') {
            return Some(blocco[da..da + l].to_string());
        }
    }
    // Forma elemento: <xmp:Rating>3</xmp:Rating>
    let apertura = format!("<{campo}>");
    let chiusura = format!("</{campo}>");
    if let Some(o) = blocco.find(&apertura) {
        let da = o + apertura.len();
        if let Some(l) = blocco[da..].find(&chiusura) {
            return Some(blocco[da..da + l].trim().to_string());
        }
    }
    None
}

/// Sostituisce il valore di un campo dentro il blocco, o lo aggiunge se non c'e'.
/// Restituisce il blocco nuovo. Tutto cio' che non e' quel campo resta com'era.
fn scrivi_campo(blocco: &str, campo: &str, valore: Option<&str>) -> String {
    let attributo = format!("{campo}=\"");
    if let Some(o) = blocco.find(&attributo) {
        let da = o + attributo.len();
        if let Some(l) = blocco[da..].find('"') {
            return match valore {
                Some(v) => format!("{}{}{}", &blocco[..da], xml_sicuro(v), &blocco[da + l..]),
                // Togliere il valore significa togliere l'attributo intero,
                // spazio precedente compreso.
                None => {
                    let mut inizio_attr = o;
                    while inizio_attr > 0
                        && blocco.as_bytes()[inizio_attr - 1].is_ascii_whitespace()
                    {
                        inizio_attr -= 1;
                    }
                    format!("{}{}", &blocco[..inizio_attr], &blocco[da + l + 1..])
                }
            };
        }
    }

    let apertura = format!("<{campo}>");
    let chiusura = format!("</{campo}>");
    if let Some(o) = blocco.find(&apertura) {
        let da = o + apertura.len();
        if let Some(l) = blocco[da..].find(&chiusura) {
            return match valore {
                Some(v) => format!("{}{}{}", &blocco[..da], xml_sicuro(v), &blocco[da + l..]),
                None => format!("{}{}", &blocco[..o], &blocco[da + l + chiusura.len()..]),
            };
        }
    }

    // Il campo non c'e'. Se non c'e' niente da scrivere, non si aggiunge niente.
    let valore = match valore {
        Some(v) => v,
        None => return blocco.to_string(),
    };
    // Si aggiunge come attributo, dentro il tag di apertura: e' la forma che
    // Camera Raw scrive, ed e' quella che non tocca il contenuto.
    if let Some(fine_apertura) = blocco.find('>') {
        let auto_chiuso = blocco[..fine_apertura].trim_end().ends_with('/');
        let taglio = if auto_chiuso {
            blocco[..fine_apertura].trim_end().len() - 1
        } else {
            fine_apertura
        };
        return format!(
            "{} {campo}=\"{}\"{}",
            blocco[..taglio].trim_end(),
            xml_sicuro(valore),
            &blocco[taglio..]
        );
    }
    blocco.to_string()
}

fn xml_sicuro(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Un sidecar nuovo, quando accanto al RAW non ce n'e' nessuno.
fn sidecar_vuoto() -> String {
    concat!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n",
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Darkroom\">\n",
        " <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n",
        "  <rdf:Description rdf:about=\"\"\n",
        "    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\">\n",
        "  </rdf:Description>\n",
        " </rdf:RDF>\n",
        "</x:xmpmeta>\n",
        "<?xpacket end=\"w\"?>\n"
    )
    .to_string()
}

/// Legge il giudizio da un testo XMP.
pub fn leggi_testo(testo: &str) -> Giudizio {
    let (da, a) = match descrizione_nostra(testo) {
        Some(v) => v,
        None => return Giudizio::default(),
    };
    let blocco = &testo[da..a];
    Giudizio {
        stelle: leggi_campo(blocco, "xmp:Rating")
            .and_then(|v| v.trim().parse::<i32>().ok())
            .and_then(|v| if (0..=5).contains(&v) { Some(v as u8) } else { None }),
        colore: leggi_campo(blocco, "xmp:Label").and_then(|v| Vocabolario::colore_da_parola(&v)),
    }
}

/// Legge il sidecar di un file, se esiste.
pub fn leggi(originale: &Path) -> Risultato<Giudizio> {
    let s = percorso_sidecar(originale);
    if !s.exists() {
        return Ok(Giudizio::default());
    }
    let testo = std::fs::read_to_string(&s).map_err(|e| Errore::NonLeggibile {
        file: s.to_string_lossy().into_owned(),
        causa: e.to_string(),
    })?;
    Ok(leggi_testo(&testo))
}

/// Applica un giudizio a un testo XMP, restituendo il testo nuovo.
pub fn applica(testo: &str, g: &Giudizio, vocabolario: Vocabolario) -> String {
    let base = if descrizione_nostra(testo).is_some() {
        testo.to_string()
    } else {
        sidecar_vuoto()
    };
    let (da, a) = match descrizione_nostra(&base) {
        Some(v) => v,
        None => return base,
    };
    let blocco = &base[da..a];
    let stelle = g.stelle.map(|v| v.to_string());
    let nuovo = scrivi_campo(blocco, "xmp:Rating", stelle.as_deref());
    let etichetta = g.colore.map(|c| vocabolario.parola(c));
    let nuovo = scrivi_campo(&nuovo, "xmp:Label", etichetta);
    format!("{}{}{}", &base[..da], nuovo, &base[a..])
}

/// Cio' che una scrittura fara', prima di farla.
#[derive(Debug, Clone)]
pub struct Piano {
    pub sidecar: PathBuf,
    pub esisteva: bool,
    pub backup: Option<PathBuf>,
    pub cambia: bool,
}

/// Prepara la scrittura senza eseguirla: dice quale file, se c'era, dove finira' la
/// copia e se il contenuto cambia davvero. Un sidecar che non cambia non si riscrive,
/// cosi' la data di modifica non mente a chi guarda la cartella.
pub fn pianifica(originale: &Path, g: &Giudizio, vocabolario: Vocabolario) -> Risultato<Piano> {
    let sidecar = percorso_sidecar(originale);
    let esisteva = sidecar.exists();
    let attuale = if esisteva {
        std::fs::read_to_string(&sidecar).map_err(|e| Errore::NonLeggibile {
            file: sidecar.to_string_lossy().into_owned(),
            causa: e.to_string(),
        })?
    } else {
        sidecar_vuoto()
    };
    let nuovo = applica(&attuale, g, vocabolario);
    let cambia = nuovo != attuale;
    Ok(Piano {
        backup: if esisteva && cambia {
            Some(cartella_backup(originale).join(
                sidecar.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            ))
        } else {
            None
        },
        sidecar,
        esisteva,
        cambia,
    })
}

/// Scrive il sidecar. Prima la copia di sicurezza, poi il file nuovo accanto e un
/// rinomina: chi legge trova il vecchio o il nuovo, mai uno a meta'.
pub fn scrivi(originale: &Path, g: &Giudizio, vocabolario: Vocabolario) -> Risultato<Piano> {
    let piano = pianifica(originale, g, vocabolario)?;
    if !piano.cambia {
        return Ok(piano);
    }
    let errore_scrittura = |p: &Path, e: std::io::Error| Errore::Scrittura {
        file: p.to_string_lossy().into_owned(),
        causa: e.to_string(),
    };

    let attuale = if piano.esisteva {
        std::fs::read_to_string(&piano.sidecar).map_err(|e| Errore::NonLeggibile {
            file: piano.sidecar.to_string_lossy().into_owned(),
            causa: e.to_string(),
        })?
    } else {
        sidecar_vuoto()
    };

    if let Some(backup) = &piano.backup {
        if let Some(cartella) = backup.parent() {
            std::fs::create_dir_all(cartella).map_err(|e| errore_scrittura(cartella, e))?;
        }
        // Il nome porta l'ora: due passate sulla stessa cartella non si cancellano.
        let quando = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let con_ora = backup.with_extension(format!("{quando}.xmp"));
        std::fs::write(&con_ora, &attuale).map_err(|e| errore_scrittura(&con_ora, e))?;
    }

    let nuovo = applica(&attuale, g, vocabolario);
    let temporaneo = piano.sidecar.with_extension("xmp.parziale");
    std::fs::write(&temporaneo, &nuovo).map_err(|e| errore_scrittura(&temporaneo, e))?;
    std::fs::rename(&temporaneo, &piano.sidecar)
        .map_err(|e| errore_scrittura(&piano.sidecar, e))?;
    Ok(piano)
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Un sidecar come lo scrive Camera Raw: con una cronologia che contiene gli
    /// stessi nomi di campo che ci interessano. E' il caso che rompe le ricerche
    /// testuali sull'intero file.
    fn con_cronologia() -> String {
        r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmp:Rating="2"
    xmp:Label="Secondo"
    crs:Exposure2012="+0.35"
    crs:Contrast2012="+12">
   <crs:History>
    <rdf:Seq>
     <rdf:li crs:action="derived" crs:parameters="xmp:Rating=5, xmp:Label=Approvato"/>
     <rdf:li crs:action="saved" crs:parameters="xmp:Rating=1"/>
    </rdf:Seq>
   </crs:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
"#
        .to_string()
    }

    #[test]
    fn il_sidecar_prende_il_nome_del_raw() {
        assert_eq!(
            percorso_sidecar(Path::new("/foto/DSC09494.ARW")),
            PathBuf::from("/foto/DSC09494.xmp")
        );
        assert_eq!(
            percorso_sidecar(Path::new("/foto/a.b.NEF")),
            PathBuf::from("/foto/a.b.xmp")
        );
    }

    #[test]
    fn si_legge_il_campo_giusto_e_non_quello_della_cronologia() {
        let g = leggi_testo(&con_cronologia());
        // La cronologia contiene 5 e 1; il valore vero e' 2.
        assert_eq!(g.stelle, Some(2));
        assert_eq!(g.colore, Some(Colore::Giallo)); // "Secondo"
    }

    #[test]
    fn la_cronologia_resta_identica_dopo_una_scrittura() {
        let prima = con_cronologia();
        let dopo = applica(
            &prima,
            &Giudizio { stelle: Some(4), colore: Some(Colore::Verde) },
            Vocabolario::Italiano,
        );
        // La cronologia non e' stata toccata.
        assert!(dopo.contains(r#"crs:parameters="xmp:Rating=5, xmp:Label=Approvato""#));
        assert!(dopo.contains(r#"crs:parameters="xmp:Rating=1""#));
        // I campi veri sono cambiati.
        assert_eq!(leggi_testo(&dopo).stelle, Some(4));
        assert_eq!(leggi_testo(&dopo).colore, Some(Colore::Verde));
    }

    #[test]
    fn le_impostazioni_di_sviluppo_altrui_restano_intatte() {
        let dopo = applica(
            &con_cronologia(),
            &Giudizio { stelle: Some(1), colore: None },
            Vocabolario::Italiano,
        );
        assert!(dopo.contains(r#"crs:Exposure2012="+0.35""#));
        assert!(dopo.contains(r#"crs:Contrast2012="+12""#));
    }

    #[test]
    fn l_etichetta_si_scrive_nel_vocabolario_chiesto() {
        let it = applica("", &Giudizio { stelle: None, colore: Some(Colore::Verde) }, Vocabolario::Italiano);
        assert!(it.contains(r#"xmp:Label="Approvato""#), "{it}");
        let en = applica("", &Giudizio { stelle: None, colore: Some(Colore::Verde) }, Vocabolario::Inglese);
        assert!(en.contains(r#"xmp:Label="Approved""#), "{en}");
    }

    #[test]
    fn un_etichetta_scritta_in_un_altra_lingua_si_legge_lo_stesso() {
        let en = applica("", &Giudizio { stelle: None, colore: Some(Colore::Blu) }, Vocabolario::Inglese);
        assert_eq!(leggi_testo(&en).colore, Some(Colore::Blu));
    }

    #[test]
    fn senza_sidecar_se_ne_costruisce_uno_valido() {
        let n = applica("", &Giudizio { stelle: Some(3), colore: Some(Colore::Rosso) }, Vocabolario::Italiano);
        assert!(n.contains("<rdf:Description"));
        assert!(n.contains("xmlns:xmp="));
        let g = leggi_testo(&n);
        assert_eq!(g.stelle, Some(3));
        assert_eq!(g.colore, Some(Colore::Rosso));
    }

    #[test]
    fn togliere_un_giudizio_toglie_il_campo_non_lo_azzera() {
        // Zero stelle e "non giudicata" sono cose diverse, e chi legge il file
        // dopo di noi deve poterle distinguere.
        let con = applica("", &Giudizio { stelle: Some(3), colore: None }, Vocabolario::Italiano);
        let senza = applica(&con, &Giudizio { stelle: None, colore: None }, Vocabolario::Italiano);
        assert!(!senza.contains("xmp:Rating"), "{senza}");
        assert_eq!(leggi_testo(&senza).stelle, None);
    }

    #[test]
    fn scrivere_lo_stesso_giudizio_non_cambia_niente() {
        let g = Giudizio { stelle: Some(2), colore: Some(Colore::Giallo) };
        let uno = applica(&con_cronologia(), &g, Vocabolario::Italiano);
        let due = applica(&uno, &g, Vocabolario::Italiano);
        assert_eq!(uno, due);
    }

    #[test]
    fn una_forma_a_elementi_invece_che_ad_attributi_si_legge_e_si_scrive() {
        let testo = r#"<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:Rating>4</xmp:Rating>
   <xmp:Label>Approvato</xmp:Label>
  </rdf:Description>"#;
        assert_eq!(leggi_testo(testo).stelle, Some(4));
        let dopo = applica(testo, &Giudizio { stelle: Some(1), colore: Some(Colore::Viola) }, Vocabolario::Italiano);
        assert_eq!(leggi_testo(&dopo).stelle, Some(1));
        assert_eq!(leggi_testo(&dopo).colore, Some(Colore::Viola));
    }

    #[test]
    fn un_valore_fuori_scala_non_si_legge_come_valido() {
        let testo = r#"<rdf:Description xmlns:xmp="x" xmp:Rating="99"/>"#;
        assert_eq!(leggi_testo(testo).stelle, None);
    }

    #[test]
    fn un_file_senza_la_nostra_descrizione_non_da_giudizi_inventati() {
        assert_eq!(leggi_testo("<x>niente</x>"), Giudizio::default());
        assert_eq!(leggi_testo(""), Giudizio::default());
    }

    #[test]
    fn un_valore_con_virgolette_o_e_commerciali_non_rompe_il_documento() {
        // Il vocabolario non contiene caratteri pericolosi, ma il campo li accetta:
        // un documento che si rompe non e' recuperabile da chi lo apre dopo.
        let blocco = r#"<rdf:Description xmlns:xmp="x"/>"#;
        let fuori = scrivi_campo(blocco, "xmp:Label", Some(r#"a"b&c<d"#));
        assert!(fuori.contains("&quot;"), "{fuori}");
        assert!(fuori.contains("&amp;"), "{fuori}");
        assert!(fuori.contains("&lt;"), "{fuori}");
        // E il documento resta uno solo: nessuna virgoletta ha chiuso l'attributo.
        assert_eq!(fuori.matches("<rdf:Description").count(), 1);
    }

    #[test]
    fn scrivere_su_disco_lascia_una_copia_e_un_file_intero() {
        let dir = std::env::temp_dir().join(format!("darkroom-xmp-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let raw = dir.join("DSC1.ARW");
        std::fs::write(&raw, b"finto").unwrap();
        let sidecar = percorso_sidecar(&raw);
        std::fs::write(&sidecar, con_cronologia()).unwrap();

        let piano = scrivi(&raw, &Giudizio { stelle: Some(5), colore: Some(Colore::Verde) }, Vocabolario::Italiano).unwrap();
        assert!(piano.cambia);
        assert!(piano.backup.is_some());

        let dopo = std::fs::read_to_string(&sidecar).unwrap();
        assert_eq!(leggi_testo(&dopo).stelle, Some(5));
        // La copia di sicurezza contiene il vecchio.
        let copie: Vec<_> = std::fs::read_dir(cartella_backup(&raw)).unwrap().filter_map(|e| e.ok()).collect();
        assert!(!copie.is_empty(), "manca la copia di sicurezza");
        let vecchio = std::fs::read_to_string(copie[0].path()).unwrap();
        assert_eq!(leggi_testo(&vecchio).stelle, Some(2));
        // Nessun file a meta' lasciato in giro.
        assert!(!dir.join("DSC1.xmp.parziale").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_giudizio_identico_non_riscrive_il_file() {
        let dir = std::env::temp_dir().join(format!("darkroom-xmp2-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let raw = dir.join("DSC2.ARW");
        std::fs::write(&raw, b"finto").unwrap();
        let g = Giudizio { stelle: Some(2), colore: Some(Colore::Giallo) };
        std::fs::write(percorso_sidecar(&raw), applica("", &g, Vocabolario::Italiano)).unwrap();

        let piano = scrivi(&raw, &g, Vocabolario::Italiano).unwrap();
        assert!(!piano.cambia, "un giudizio identico non deve toccare il file");
        assert!(piano.backup.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
