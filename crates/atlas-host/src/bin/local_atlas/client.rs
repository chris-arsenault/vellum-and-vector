//! The local server's CBOR services over loopback HTTP/1.1, one connection per call.
use serde::{
    de::{DeserializeOwned, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use std::{
    fmt,
    io::{self, BufRead, BufReader, Read, Write},
    net::TcpStream,
};

pub struct Server {
    address: String,
}
impl Server {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            address: format!("{host}:{port}"),
        }
    }
    /// Calls a service such as `generation` or `maps/read` with a structured request.
    pub fn call<T: DeserializeOwned>(&self, service: &str, body: &impl Serialize) -> io::Result<T> {
        let mut payload = Vec::new();
        ciborium::into_writer(body, &mut payload).map_err(io::Error::other)?;
        let reply = self.request("POST", &format!("/api/{service}"), Some(&payload))?;
        ciborium::from_reader(reply.as_slice())
            .map_err(|error| io::Error::other(format!("{service} reply: {error}")))
    }
    pub fn get(&self, path: &str) -> io::Result<Vec<u8>> {
        self.request("GET", path, None)
    }
    fn request(&self, method: &str, path: &str, body: Option<&[u8]>) -> io::Result<Vec<u8>> {
        let stream = TcpStream::connect(&self.address).map_err(|_| {
            io::Error::other(format!(
                "No local atlas at http://{}; run make local-up",
                self.address
            ))
        })?;
        let mut writer = stream.try_clone()?;
        write!(
            writer,
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
            self.address
        )?;
        match body {
            Some(body) => {
                write!(
                    writer,
                    "Content-Type: application/cbor\r\nContent-Length: {}\r\n\r\n",
                    body.len()
                )?;
                writer.write_all(body)?;
            }
            None => write!(writer, "\r\n")?,
        }
        writer.flush()?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let status: u16 = line
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .ok_or_else(|| io::Error::other(format!("Unexpected reply: {line}")))?;
        let mut length = None;
        let mut chunked = false;
        loop {
            line.clear();
            reader.read_line(&mut line)?;
            let header = line.trim_end();
            if header.is_empty() {
                break;
            }
            if let Some((name, value)) = header.split_once(':') {
                let value = value.trim();
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.parse::<usize>().ok();
                } else if name.eq_ignore_ascii_case("transfer-encoding") {
                    chunked = value.eq_ignore_ascii_case("chunked");
                }
            }
        }
        let mut reply = Vec::new();
        if chunked {
            loop {
                line.clear();
                reader.read_line(&mut line)?;
                let size = line.trim().split(';').next().unwrap_or_default();
                let size = usize::from_str_radix(size, 16).map_err(io::Error::other)?;
                if size == 0 {
                    break;
                }
                let start = reply.len();
                reply.resize(start + size, 0);
                reader.read_exact(&mut reply[start..])?;
                line.clear();
                reader.read_line(&mut line)?;
            }
        } else if let Some(length) = length {
            reply.resize(length, 0);
            reader.read_exact(&mut reply)?;
        } else {
            reader.read_to_end(&mut reply)?;
        }
        if !(200..300).contains(&status) {
            return Err(io::Error::other(
                String::from_utf8_lossy(&reply).into_owned(),
            ));
        }
        Ok(reply)
    }
}

/// Bytes the server sends either as a CBOR byte string or as a list of numbers.
pub struct Bytes(pub Vec<u8>);
impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Read;
        impl<'de> Visitor<'de> for Read {
            type Value = Bytes;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("bytes")
            }
            fn visit_bytes<E>(self, bytes: &[u8]) -> Result<Bytes, E> {
                Ok(Bytes(bytes.to_vec()))
            }
            fn visit_byte_buf<E>(self, bytes: Vec<u8>) -> Result<Bytes, E> {
                Ok(Bytes(bytes))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut items: A) -> Result<Bytes, A::Error> {
                let mut bytes = Vec::with_capacity(items.size_hint().unwrap_or(0));
                while let Some(byte) = items.next_element::<u8>()? {
                    bytes.push(byte);
                }
                Ok(Bytes(bytes))
            }
        }
        deserializer.deserialize_byte_buf(Read)
    }
}
