//! Cache delle anteprime, con un budget in byte per livello.
//!
//! Il budget si conta in byte e non in numero di voci perche' i quattro livelli non
//! pesano la stessa cosa: a 512 px un fotogramma sta in 0,7 MB, a 3840 px ne occupa 39,
//! e alla risoluzione nativa di un 45 megapixel arriva a 180. Millecinquecento voci
//! sono un gigabyte al primo livello e decine all'ultimo — un conteggio non lo dice.
//!
//! I livelli hanno budget separati e non uno solo, perche' con un budget comune
//! scorrere una griglia da duemila scatti sfratterebbe i proxy che rendono istantanea
//! la striscia. Un livello che si svuota da solo non e' un precaricamento, e' una
//! promessa.

use std::collections::HashMap;

/// Tetto complessivo: un ottavo della memoria fisica, e comunque mai oltre 2 GB.
pub fn budget_totale(memoria_fisica: u64) -> u64 {
    (memoria_fisica / 8).min(2 * 1024 * 1024 * 1024)
}

/// Quote per livello, in percentuale del budget totale.
/// Il visore prende la fetta piu' grande perche' e' quello che si paga di piu' a
/// ricostruire; i proxy ne prendono poco perche' costano poco ma servono sempre.
pub fn quota(livello: crate::preview::Livello) -> u32 {
    use crate::preview::Livello::*;
    match livello {
        Proxy => 20,
        Griglia => 10,
        Visore => 50,
        Nativo => 20,
    }
}

/// Una cache a sfratto del meno usato di recente, limitata in byte.
pub struct CacheLivello<V> {
    budget: u64,
    occupati: u64,
    /// Contatore monotono: chi ha il numero piu' basso e' il piu' vecchio.
    orologio: u64,
    voci: HashMap<String, (V, u64, u64)>, // valore, peso, ultimo uso
}

impl<V> CacheLivello<V> {
    pub fn nuova(budget: u64) -> Self {
        CacheLivello { budget, occupati: 0, orologio: 0, voci: HashMap::new() }
    }

    pub fn budget(&self) -> u64 {
        self.budget
    }

    pub fn occupati(&self) -> u64 {
        self.occupati
    }

    pub fn quante(&self) -> usize {
        self.voci.len()
    }

    pub fn prendi(&mut self, chiave: &str) -> Option<&V> {
        self.orologio += 1;
        let ora = self.orologio;
        match self.voci.get_mut(chiave) {
            Some(v) => {
                v.2 = ora;
                Some(&v.0)
            }
            None => None,
        }
    }

    /// Inserisce, sfrattando quanto basta. Un valore piu' grande dell'intero budget
    /// non viene messo in cache: tenerlo significherebbe svuotare tutto per uno solo.
    pub fn metti(&mut self, chiave: String, valore: V, peso: u64) -> bool {
        if peso > self.budget {
            return false;
        }
        if let Some((_, vecchio_peso, _)) = self.voci.remove(&chiave) {
            self.occupati -= vecchio_peso;
        }
        while self.occupati + peso > self.budget {
            if !self.sfratta_il_piu_vecchio() {
                break;
            }
        }
        self.orologio += 1;
        self.voci.insert(chiave, (valore, peso, self.orologio));
        self.occupati += peso;
        true
    }

    fn sfratta_il_piu_vecchio(&mut self) -> bool {
        let piu_vecchio = self
            .voci
            .iter()
            .min_by_key(|(_, (_, _, uso))| *uso)
            .map(|(k, _)| k.clone());
        match piu_vecchio {
            Some(k) => {
                if let Some((_, peso, _)) = self.voci.remove(&k) {
                    self.occupati -= peso;
                }
                true
            }
            None => false,
        }
    }

    pub fn svuota(&mut self) {
        self.voci.clear();
        self.occupati = 0;
    }
}

#[cfg(test)]
mod prove {
    use super::*;
    use crate::preview::Livello;

    #[test]
    fn il_budget_e_un_ottavo_ma_non_oltre_due_giga() {
        assert_eq!(budget_totale(8 * 1024 * 1024 * 1024), 1024 * 1024 * 1024);
        // Su una macchina grande il tetto morde.
        assert_eq!(budget_totale(64 * 1024 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
    }

    #[test]
    fn le_quote_dei_livelli_fanno_cento() {
        let somma: u32 = [Livello::Proxy, Livello::Griglia, Livello::Visore, Livello::Nativo]
            .iter()
            .map(|l| quota(*l))
            .sum();
        assert_eq!(somma, 100);
    }

    #[test]
    fn cio_che_si_mette_si_ritrova() {
        let mut c: CacheLivello<u32> = CacheLivello::nuova(100);
        c.metti("a".into(), 1, 10);
        assert_eq!(c.prendi("a"), Some(&1));
    }

    #[test]
    fn si_sfratta_il_meno_usato_di_recente_non_il_primo_arrivato() {
        let mut c: CacheLivello<u32> = CacheLivello::nuova(30);
        c.metti("a".into(), 1, 10);
        c.metti("b".into(), 2, 10);
        c.metti("c".into(), 3, 10);
        // Si tocca "a": ora il piu' vecchio e' "b".
        assert_eq!(c.prendi("a"), Some(&1));
        c.metti("d".into(), 4, 10);
        assert_eq!(c.prendi("b"), None, "avrebbe dovuto uscire il meno usato");
        assert_eq!(c.prendi("a"), Some(&1), "quello appena toccato deve restare");
    }

    #[test]
    fn il_peso_e_in_byte_non_in_voci() {
        let mut c: CacheLivello<u32> = CacheLivello::nuova(100);
        c.metti("piccolo".into(), 1, 10);
        c.metti("enorme".into(), 2, 90);
        assert_eq!(c.occupati(), 100);
        // Una terza voce piccola sfratta, perche' il budget e' pieno di byte.
        c.metti("altro".into(), 3, 10);
        assert!(c.occupati() <= 100);
        assert!(c.quante() < 3 || c.occupati() <= 100);
    }

    #[test]
    fn un_valore_piu_grande_del_budget_non_entra() {
        let mut c: CacheLivello<u32> = CacheLivello::nuova(50);
        assert!(!c.metti("mostro".into(), 1, 500));
        assert_eq!(c.quante(), 0);
        assert_eq!(c.occupati(), 0);
    }

    #[test]
    fn rimettere_la_stessa_chiave_non_conta_due_volte() {
        let mut c: CacheLivello<u32> = CacheLivello::nuova(100);
        c.metti("a".into(), 1, 40);
        c.metti("a".into(), 2, 40);
        assert_eq!(c.occupati(), 40);
        assert_eq!(c.prendi("a"), Some(&2));
    }

    #[test]
    fn la_memoria_non_supera_mai_il_tetto() {
        let mut c: CacheLivello<Vec<u8>> = CacheLivello::nuova(1000);
        for i in 0..500 {
            c.metti(format!("k{i}"), vec![0u8; 100], 100);
            assert!(c.occupati() <= 1000, "sforato al giro {i}");
        }
    }
}
