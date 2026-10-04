"""Quando Darkroom apre e richiude OpenBrowser. `python3 -m unittest scripts/test_ob_browser.py`"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ob_browser as ob  # noqa: E402

CHATGPT = {"id": "a", "url": "https://chatgpt.com/c/1"}
PREFERITA = {"id": "f", "type": "fav", "url": "https://mail.google.com/"}
PERSONA = {"id": "p", "url": "https://github.com/"}


class Modulo(unittest.TestCase):
    def test_lo_strato_browser_e_ancora_tutto_qui(self):
        # Una riscrittura del ciclo di vita ha gia' cancellato OBCDP per sbaglio:
        # i test sotto sostituiscono quelle parti, quindi lo controlla questo.
        for nome in ("OBCDP", "_credenziali", "_sessione", "open_openbrowser"):
            self.assertTrue(callable(getattr(ob, nome, None)), nome)


class DaChiudere(unittest.TestCase):
    def test_fermo_da_abbastanza_e_solo_chatgpt_si_chiude(self):
        self.assertTrue(ob.da_chiudere(segno=True, usi=0, fermo_da_s=ob.INATTIVO_S, schede=[CHATGPT, PREFERITA]))

    def test_mai_se_non_lo_ha_aperto_darkroom(self):
        self.assertFalse(ob.da_chiudere(segno=False, usi=0, fermo_da_s=10**6, schede=[CHATGPT]))

    def test_mai_mentre_un_job_lo_usa(self):
        self.assertFalse(ob.da_chiudere(segno=True, usi=1, fermo_da_s=10**6, schede=[CHATGPT]))

    def test_la_pausa_fra_due_job_non_basta(self):
        self.assertFalse(ob.da_chiudere(segno=True, usi=0, fermo_da_s=35, schede=[CHATGPT]))

    def test_mai_se_una_persona_ci_naviga(self):
        self.assertFalse(ob.da_chiudere(segno=True, usi=0, fermo_da_s=10**6, schede=[CHATGPT, PERSONA]))


class UsiVivi(unittest.TestCase):
    def test_un_uso_di_un_processo_morto_non_conta_e_si_cancella(self):
        with tempfile.TemporaryDirectory() as d:
            cartella = Path(d)
            vivo = cartella / f"uso-{os.getpid()}-aa"
            vivo.touch()
            figlio = subprocess.Popen(["true"])
            figlio.wait()
            morto_pid = figlio.pid
            morto = cartella / f"uso-{morto_pid}-bb"
            morto.touch()
            self.assertEqual(ob.usi_vivi(cartella), [vivo])
            self.assertFalse(morto.exists())


class Avvio(unittest.TestCase):
    """Il segno decide chi puo' chiudere: deve nascere SOLO se Darkroom lo ha avviato."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.segno = Path(self.tmp.name) / "segno"
        self.p = [
            mock.patch.object(ob, "SEGNO", self.segno),
            mock.patch.object(ob.subprocess, "run"),
            mock.patch.object(ob.time, "sleep"),
        ]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()
        self.tmp.cleanup()

    def test_spento_lo_apre_e_lo_segna(self):
        risposte = iter([None, {"tabs": []}])
        with mock.patch.object(ob, "_richiesta", side_effect=lambda *a: next(risposte)), \
             mock.patch.object(ob, "_in_esecuzione", return_value=False):
            ob._avvia_se_spento()
        self.assertTrue(self.segno.exists())

    def test_aperto_da_attilio_con_api_muta_non_diventa_di_darkroom(self):
        risposte = iter([None, {"tabs": []}])
        with mock.patch.object(ob, "_richiesta", side_effect=lambda *a: next(risposte)), \
             mock.patch.object(ob, "_in_esecuzione", return_value=True):
            ob._avvia_se_spento()
        self.assertFalse(self.segno.exists())
        ob.subprocess.run.assert_not_called()

    def test_gia_pronto_non_tocca_niente(self):
        with mock.patch.object(ob, "_richiesta", return_value={"tabs": []}):
            ob._avvia_se_spento()
        self.assertFalse(self.segno.exists())


if __name__ == "__main__":
    unittest.main()
