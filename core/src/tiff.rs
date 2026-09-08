//! Lettura della struttura TIFF che sta dentro ogni RAW dei corpi diffusi.
//!
//! Tutte le letture passano da `Lettore`, che controlla i limiti a ogni accesso.
//! Il motivo non e' pedanteria: questo e' l'unico punto del progetto in cui un file
//! scritto da terzi tocca un parser binario, e un offset inventato non deve poter
//! diventare altro che un errore.

use crate::error::{Errore, Risultato};

/// Numero massimo di IFD visitati prima di dichiarare la struttura irragionevole.
/// Un RAW vero ne ha meno di dieci; oltre questo tetto si e' dentro a un ciclo o a
/// un file costruito apposta.
const TETTO_IFD: usize = 64;

/// Numero massimo di voci in un singolo IFD. Il campo che le conta sta nel file.
const TETTO_VOCI: usize = 4096;

pub struct Lettore<'a> {
    dati: &'a [u8],
    little_endian: bool,
    nome: String,
}

impl<'a> Lettore<'a> {
    pub fn nuovo(dati: &'a [u8], nome: &str) -> Risultato<Self> {
        if dati.len() < 8 {
            return Err(Errore::NonTiff { file: nome.to_string() });
        }
        let little_endian = match &dati[0..2] {
            b"II" => true,
            b"MM" => false,
            _ => return Err(Errore::NonTiff { file: nome.to_string() }),
        };
        let l = Lettore { dati, little_endian, nome: nome.to_string() };
        // 42 e' il numero magico del TIFF; 43 sarebbe BigTIFF, che qui non trattiamo.
        if l.u16(2)? != 42 {
            return Err(Errore::NonTiff { file: nome.to_string() });
        }
        Ok(l)
    }

    fn malformato(&self, dettaglio: &str) -> Errore {
        Errore::Malformato { file: self.nome.clone(), dettaglio: dettaglio.to_string() }
    }

    pub fn u16(&self, o: usize) -> Risultato<u16> {
        let f = self
            .dati
            .get(o..o + 2)
            .ok_or_else(|| self.malformato("lettura di 2 byte oltre la fine del file"))?;
        let v = [f[0], f[1]];
        Ok(if self.little_endian { u16::from_le_bytes(v) } else { u16::from_be_bytes(v) })
    }

    pub fn u32(&self, o: usize) -> Risultato<u32> {
        let f = self
            .dati
            .get(o..o + 4)
            .ok_or_else(|| self.malformato("lettura di 4 byte oltre la fine del file"))?;
        let v = [f[0], f[1], f[2], f[3]];
        Ok(if self.little_endian { u32::from_le_bytes(v) } else { u32::from_be_bytes(v) })
    }

    /// Primo valore di una voce, qualunque sia il tipo intero dichiarato.
    /// I tipi non interi restituiscono `None`: non sono un errore del file, sono
    /// semplicemente campi che a noi non servono.
    fn valore(&self, voce: usize) -> Risultato<Option<u32>> {
        let tipo = self.u16(voce + 2)?;
        Ok(match tipo {
            1 => self.dati.get(voce + 8).map(|b| *b as u32), // BYTE
            3 => Some(self.u16(voce + 8)? as u32),           // SHORT
            4 => Some(self.u32(voce + 8)?),                  // LONG
            _ => None,
        })
    }

    /// Tutti gli offset elencati da una voce che ne contiene piu' d'uno
    /// (il caso di `SubIFDs`, che in un NEF punta a due o tre catene).
    fn offset_multipli(&self, voce: usize) -> Risultato<Vec<usize>> {
        let quanti = self.u32(voce + 4)? as usize;
        if quanti == 0 || quanti > TETTO_VOCI {
            return Ok(Vec::new());
        }
        if quanti == 1 {
            return Ok(self.valore(voce)?.map(|v| vec![v as usize]).unwrap_or_default());
        }
        // Piu' di un valore non ci sta nei 4 byte della voce: sono altrove.
        let base = self.u32(voce + 8)? as usize;
        let mut fuori = Vec::with_capacity(quanti.min(TETTO_IFD));
        for k in 0..quanti.min(TETTO_IFD) {
            fuori.push(self.u32(base + k * 4)? as usize);
        }
        Ok(fuori)
    }
}

/// Un'immagine JPEG trovata dentro il contenitore, con quello che il file dichiara su di lei.
#[derive(Debug, Clone, Copy)]
pub struct Anteprima {
    pub inizio: usize,
    pub lunghezza: usize,
    /// Lato lungo dichiarato dall'IFD che la contiene, quando c'e'.
    /// Non e' la stessa cosa della dimensione reale del JPEG: serve solo a ordinare
    /// i candidati prima di decodificarli.
    pub lato_lungo_dichiarato: Option<u32>,
}

/// Ciò che serve sapere di un RAW senza decodificarlo.
#[derive(Debug, Clone)]
pub struct Struttura {
    pub anteprime: Vec<Anteprima>,
    pub orientamento: u16,
    /// Lato lungo dello scatto intero, come dichiarato dal file.
    pub lato_lungo_scatto: Option<u32>,
}

impl Struttura {
    /// L'anteprima piu' grande, che e' quasi sempre quella che si vuole.
    pub fn migliore(&self) -> Option<&Anteprima> {
        self.anteprime.iter().max_by_key(|a| a.lunghezza)
    }
}

/// Percorre gli IFD e raccoglie ogni fetta che inizia con la firma di un JPEG.
///
/// Non ci si fida della sola coppia offset/lunghezza: prima di accettare un candidato
/// si controlla che i byte puntati comincino davvero per `FF D8`. Un file che dichiara
/// un'anteprima dove non c'e' produce un `SenzaAnteprima`, non una lettura a caso.
pub fn leggi(dati: &[u8], nome: &str) -> Risultato<Struttura> {
    let l = Lettore::nuovo(dati, nome)?;

    let mut anteprime = Vec::new();
    let mut orientamento = 1u16;
    let mut lato_lungo_scatto: Option<u32> = None;

    let mut da_visitare = vec![l.u32(4)? as usize];
    let mut visitati: Vec<usize> = Vec::new();

    while let Some(ifd) = da_visitare.pop() {
        if ifd == 0 || visitati.contains(&ifd) {
            continue;
        }
        if visitati.len() >= TETTO_IFD {
            // Struttura irragionevole. Ci si ferma con quello che si e' raccolto
            // invece di restituire un errore: un file con troppi IFD ma con
            // un'anteprima valida resta utilizzabile.
            break;
        }
        visitati.push(ifd);

        let quante = match l.u16(ifd) {
            Ok(n) => n as usize,
            Err(_) => continue, // IFD che punta fuori dal file: si salta, non si muore
        };
        if quante > TETTO_VOCI {
            continue;
        }

        let mut inizio: Option<usize> = None;
        let mut lunghezza: Option<usize> = None;
        let mut larghezza: Option<u32> = None;
        let mut altezza: Option<u32> = None;

        for i in 0..quante {
            let voce = ifd + 2 + i * 12;
            let tag = match l.u16(voce) {
                Ok(t) => t,
                Err(_) => break, // voce troncata: il resto dell'IFD non e' leggibile
            };
            match tag {
                0x0100 => larghezza = l.valore(voce)?,
                0x0101 => altezza = l.valore(voce)?,
                0x0112 => {
                    if let Some(v) = l.valore(voce)? {
                        if (1..=8).contains(&v) {
                            orientamento = v as u16;
                        }
                    }
                }
                // SubIFDs ed Exif IFD: altre catene da percorrere.
                0x014A | 0x8769 => {
                    for o in l.offset_multipli(voce)? {
                        if o != 0 && !visitati.contains(&o) {
                            da_visitare.push(o);
                        }
                    }
                }
                0x0111 | 0x0201 => inizio = l.valore(voce)?.map(|v| v as usize),
                0x0117 | 0x0202 => lunghezza = l.valore(voce)?.map(|v| v as usize),
                _ => {}
            }
        }

        // Catena verso l'IFD successivo.
        if let Ok(prossimo) = l.u32(ifd + 2 + quante * 12) {
            let p = prossimo as usize;
            if p != 0 && !visitati.contains(&p) {
                da_visitare.push(p);
            }
        }

        let lato = match (larghezza, altezza) {
            (Some(w), Some(h)) => Some(w.max(h)),
            _ => None,
        };
        if let Some(lato) = lato {
            lato_lungo_scatto = Some(lato_lungo_scatto.map_or(lato, |v: u32| v.max(lato)));
        }

        if let (Some(inizio), Some(lunghezza)) = (inizio, lunghezza) {
            if e_jpeg(dati, inizio, lunghezza) {
                anteprime.push(Anteprima {
                    inizio,
                    lunghezza,
                    lato_lungo_dichiarato: lato,
                });
            }
        }
    }

    if anteprime.is_empty() {
        return Err(Errore::SenzaAnteprima { file: nome.to_string() });
    }
    Ok(Struttura { anteprime, orientamento, lato_lungo_scatto })
}

/// Vero solo se la fetta esiste per intero dentro il file e comincia con la firma JPEG.
fn e_jpeg(dati: &[u8], inizio: usize, lunghezza: usize) -> bool {
    if lunghezza < 4 {
        return false;
    }
    match inizio.checked_add(lunghezza) {
        Some(fine) if fine <= dati.len() => dati[inizio] == 0xFF && dati[inizio + 1] == 0xD8,
        _ => false,
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Costruisce un TIFF minimo con un IFD e le voci indicate.
    fn tiff(voci: &[(u16, u16, u32)], carico: &[u8], offset_carico: u32) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"II");
        b.extend_from_slice(&42u16.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        b.extend_from_slice(&(voci.len() as u16).to_le_bytes());
        for (tag, tipo, valore) in voci {
            b.extend_from_slice(&tag.to_le_bytes());
            b.extend_from_slice(&tipo.to_le_bytes());
            b.extend_from_slice(&1u32.to_le_bytes());
            b.extend_from_slice(&valore.to_le_bytes());
        }
        b.extend_from_slice(&0u32.to_le_bytes()); // nessun IFD successivo
        while b.len() < offset_carico as usize {
            b.push(0);
        }
        b.extend_from_slice(carico);
        b
    }

    #[test]
    fn un_file_troppo_corto_non_e_tiff() {
        let e = leggi(&[0u8; 3], "corto").unwrap_err();
        assert_eq!(e.codice(), "non_tiff");
        assert_eq!(e.file(), "corto");
    }

    #[test]
    fn un_file_senza_firma_non_e_tiff() {
        let e = leggi(&[0u8; 64], "ignoto").unwrap_err();
        assert_eq!(e.codice(), "non_tiff");
    }

    #[test]
    fn un_jpeg_incorporato_si_trova() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9];
        let b = tiff(
            &[(0x0100, 3, 100), (0x0101, 3, 50), (0x0201, 4, 200), (0x0202, 4, jpg.len() as u32)],
            &jpg,
            200,
        );
        let s = leggi(&b, "buono").unwrap();
        let a = s.migliore().unwrap();
        assert_eq!(a.inizio, 200);
        assert_eq!(a.lunghezza, jpg.len());
        assert_eq!(a.lato_lungo_dichiarato, Some(100));
    }

    #[test]
    fn un_offset_oltre_la_fine_non_diventa_un_anteprima() {
        // Dichiara un'anteprima a un offset che nel file non esiste.
        let b = tiff(&[(0x0201, 4, 90_000), (0x0202, 4, 1024)], &[], 100);
        let e = leggi(&b, "bugiardo").unwrap_err();
        assert_eq!(e.codice(), "senza_anteprima");
    }

    #[test]
    fn una_lunghezza_che_trabocca_non_legge_fuori() {
        let b = tiff(&[(0x0201, 4, 100), (0x0202, 4, u32::MAX)], &[0xFF, 0xD8], 100);
        let e = leggi(&b, "traboccante").unwrap_err();
        assert_eq!(e.codice(), "senza_anteprima");
    }

    #[test]
    fn una_fetta_che_non_comincia_per_jpeg_viene_scartata() {
        let non_jpg = [0x00, 0x11, 0x22, 0x33];
        let b = tiff(&[(0x0201, 4, 200), (0x0202, 4, 4)], &non_jpg, 200);
        assert_eq!(leggi(&b, "non_jpeg").unwrap_err().codice(), "senza_anteprima");
    }

    #[test]
    fn un_ifd_che_punta_a_se_stesso_non_gira_per_sempre() {
        // IFD0 dichiara un SubIFD che e' se stesso.
        let jpg = [0xFF, 0xD8, 0xFF, 0xD9];
        let b = tiff(&[(0x014A, 4, 8), (0x0201, 4, 200), (0x0202, 4, 4)], &jpg, 200);
        let s = leggi(&b, "ciclico").unwrap();
        assert_eq!(s.anteprime.len(), 1);
    }

    #[test]
    fn un_file_troncato_a_meta_non_va_in_panico() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xD9];
        let intero = tiff(&[(0x0201, 4, 200), (0x0202, 4, 4)], &jpg, 200);
        for taglio in [9, 12, 20, 30, intero.len() - 1] {
            // Non ci interessa quale errore esca: ci interessa che non sia un panico.
            let _ = leggi(&intero[..taglio.min(intero.len())], "troncato");
        }
    }

    #[test]
    fn l_orientamento_si_legge() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xD9];
        let b = tiff(
            &[(0x0112, 3, 6), (0x0201, 4, 200), (0x0202, 4, 4)],
            &jpg,
            200,
        );
        assert_eq!(leggi(&b, "ruotato").unwrap().orientamento, 6);
    }

    #[test]
    fn un_orientamento_fuori_scala_viene_ignorato() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xD9];
        let b = tiff(&[(0x0112, 3, 99), (0x0201, 4, 200), (0x0202, 4, 4)], &jpg, 200);
        assert_eq!(leggi(&b, "assurdo").unwrap().orientamento, 1);
    }
}
