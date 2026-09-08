// Estrae l'anteprima JPEG incorporata in un RAW (TIFF-based: ARW/NEF/CR2/DNG),
// la decodifica e la riduce al lato lungo richiesto. Nessuna dipendenza macOS.
use fast_image_resize::images::Image;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use memmap2::Mmap;
use rayon::prelude::*;
use std::fs::File;
use std::time::Instant;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;
use zune_jpeg::JpegDecoder;

struct Tiff<'a> { b: &'a [u8], le: bool }

impl<'a> Tiff<'a> {
    fn u16(&self, o: usize) -> u16 {
        let v = [self.b[o], self.b[o + 1]];
        if self.le { u16::from_le_bytes(v) } else { u16::from_be_bytes(v) }
    }
    fn u32(&self, o: usize) -> u32 {
        let v = [self.b[o], self.b[o + 1], self.b[o + 2], self.b[o + 3]];
        if self.le { u32::from_le_bytes(v) } else { u32::from_be_bytes(v) }
    }
    // valore scalare di un tag, qualunque sia il tipo intero
    fn val(&self, entry: usize) -> u32 {
        match self.u16(entry + 2) {
            3 => self.u16(entry + 8) as u32,
            _ => self.u32(entry + 8),
        }
    }
}

/// Ritorna la fetta JPEG più grande trovata negli IFD del file.
fn embedded_jpeg(buf: &[u8]) -> Option<&[u8]> {
    if buf.len() < 8 { return None; }
    let le = match &buf[0..2] { b"II" => true, b"MM" => false, _ => return None };
    let t = Tiff { b: buf, le };
    if t.u16(2) != 42 { return None; }

    let mut best: Option<&[u8]> = None;
    let mut queue = vec![t.u32(4) as usize];
    let mut seen = Vec::new();

    while let Some(ifd) = queue.pop() {
        if ifd == 0 || ifd + 2 > buf.len() || seen.contains(&ifd) { continue; }
        seen.push(ifd);
        if seen.len() > 64 { break; }

        let n = t.u16(ifd) as usize;
        if ifd + 2 + n * 12 + 4 > buf.len() { continue; }

        let (mut off, mut len) = (0usize, 0usize);
        for i in 0..n {
            let e = ifd + 2 + i * 12;
            match t.u16(e) {
                // SubIFDs: altri IFD da visitare
                0x014A => {
                    let cnt = t.u32(e + 4) as usize;
                    if cnt == 1 { queue.push(t.u32(e + 8) as usize); }
                    else {
                        let p = t.u32(e + 8) as usize;
                        for k in 0..cnt.min(16) {
                            if p + k * 4 + 4 <= buf.len() { queue.push(t.u32(p + k * 4) as usize); }
                        }
                    }
                }
                // JPEGInterchangeFormat / StripOffsets
                0x0201 | 0x0111 => off = t.val(e) as usize,
                0x0202 | 0x0117 => len = t.val(e) as usize,
                _ => {}
            }
        }
        // IFD successivo nella catena
        queue.push(t.u32(ifd + 2 + n * 12) as usize);

        if off > 0 && len > 4 && off + len <= buf.len() && buf[off] == 0xFF && buf[off + 1] == 0xD8 {
            let cand = &buf[off..off + len];
            if best.map_or(true, |b| cand.len() > b.len()) { best = Some(cand); }
        }
    }
    best
}

fn thumb(path: &str, target: u32) -> Option<(u32, u32)> {
    let f = File::open(path).ok()?;
    let m = unsafe { Mmap::map(&f) }.ok()?;
    let jpg = embedded_jpeg(&m)?;

    let opts = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut dec = JpegDecoder::new_with_options(jpg, opts);
    let px = dec.decode().ok()?;
    let (w, h) = dec.dimensions()?;
    let (w, h) = (w as u32, h as u32);

    let scale = target as f32 / w.max(h) as f32;
    if scale >= 1.0 { return Some((w, h)); }
    let (dw, dh) = (((w as f32 * scale) as u32).max(1), ((h as f32 * scale) as u32).max(1));

    let src = Image::from_vec_u8(w, h, px, PixelType::U8x3).ok()?;
    let mut dst = Image::new(dw, dh, PixelType::U8x3);
    Resizer::new().resize(&src, &mut dst, &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))).ok()?;
    Some((dw, dh))
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let dir = &a[1];
    let target: u32 = a[2].parse().unwrap_or(512);
    let parallel = a.get(3).map_or(false, |m| m == "parallel");

    let mut files: Vec<String> = std::fs::read_dir(dir).unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path().to_string_lossy().into_owned())
        .filter(|p| p.to_uppercase().ends_with(".ARW"))
        .collect();
    files.sort();

    // stesso riscaldamento della page cache dato al concorrente
    for f in &files { let _ = std::fs::read(f); }

    let t0 = Instant::now();
    let last: Option<(u32, u32)> = if parallel {
        files.par_iter().map(|f| thumb(f, target)).reduce(|| None, |_, b| b)
    } else {
        files.iter().map(|f| thumb(f, target)).last().flatten()
    };
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!("Rust {} {}px: {} file, {:.0} ms totali, {:.1} ms/file (ultimo {:?})",
        if parallel { "parallel" } else { "serial" }, target, files.len(), ms, ms / files.len() as f64, last);
}
