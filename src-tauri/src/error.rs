use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AtlasError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("pool: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("xml: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("xml-attr: {0}")]
    XmlAttr(#[from] quick_xml::events::attributes::AttrError),
    #[error("walk: {0}")]
    Walk(#[from] walkdir::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
}

impl From<&str> for AtlasError {
    fn from(s: &str) -> Self {
        AtlasError::Msg(s.to_string())
    }
}

impl From<String> for AtlasError {
    fn from(s: String) -> Self {
        AtlasError::Msg(s)
    }
}

impl Serialize for AtlasError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AtlasError>;
