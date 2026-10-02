use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::io::Cursor;
use webp::{Encoder, WebPMemory};

/// Decodes a Base64 image from the frontend, resizes it if it exceeds 2048×2048,
/// and re-encodes it as WebP. Returns the original bytes if they are already smaller.
pub(super) fn process_avatar(base64_img: &str) -> Result<Vec<u8>, String> {
    let clean_base64 = base64_img.split(',').last().unwrap_or(base64_img);
    let img_bytes = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Base64 error: {}", e))?;

    let original_size = img_bytes.len();
    let format = image::guess_format(&img_bytes).unwrap_or(ImageFormat::Png);
    let img =
        image::load_from_memory(&img_bytes).map_err(|e| format!("Image loading error: {}", e))?;

    let needs_resize = img.width() > 2048 || img.height() > 2048;

    if !needs_resize && matches!(format, ImageFormat::Jpeg | ImageFormat::WebP) {
        return Ok(img_bytes);
    }

    let resized = if needs_resize {
        img.thumbnail(2048, 2048)
    } else {
        img
    };

    if format == ImageFormat::Jpeg {
        for quality in [85, 80, 75, 60] {
            let mut buf = Cursor::new(Vec::new());
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            if enc.encode_image(&resized).is_ok() {
                let result = buf.into_inner();
                if result.len() < original_size {
                    return Ok(result);
                }
            }
        }
    }

    let rgba = resized.to_rgba8();
    let webp: WebPMemory =
        Encoder::from_rgba(rgba.as_raw(), resized.width(), resized.height()).encode(92.0);
    let result = webp.to_vec();

    if result.len() < original_size || !needs_resize {
        Ok(result)
    } else {
        Ok(img_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_data_urls_are_encoded_and_large_images_keep_the_size_limit() {
        for (width, height) in [(32, 24), (2400, 1200)] {
            let image = image::DynamicImage::new_rgba8(width, height);
            let mut png = Cursor::new(Vec::new());
            image.write_to(&mut png, ImageFormat::Png).unwrap();
            let input = format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(png.into_inner())
            );
            let result = process_avatar(&input).unwrap();
            assert_eq!(image::guess_format(&result).unwrap(), ImageFormat::WebP);
            let decoded = image::load_from_memory(&result).unwrap();
            assert_eq!(decoded.width(), width.min(2048));
            assert_eq!(decoded.height(), if width > 2048 { 1024 } else { height });
        }
    }

    #[test]
    fn small_jpeg_is_preserved_and_invalid_uploads_are_rejected() {
        let image = image::DynamicImage::new_rgb8(32, 24);
        let mut jpeg = Cursor::new(Vec::new());
        image.write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
        let bytes = jpeg.into_inner();
        assert_eq!(
            process_avatar(&general_purpose::STANDARD.encode(&bytes)).unwrap(),
            bytes
        );
        assert!(process_avatar("not base64!")
            .unwrap_err()
            .starts_with("Base64 error:"));
        assert!(
            process_avatar(&general_purpose::STANDARD.encode(b"not an image"))
                .unwrap_err()
                .starts_with("Image loading error:")
        );
    }
}
