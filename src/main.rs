use axum::{
    body::Body, routing::get, Router
};

use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};


#[tokio::main]
async fn main() {
    let api = Router::new()
    .route("/api/v1/hello", get(|| async {
        axum::Json(serde_json::json!("hello!"))
    }));

    let frontend = ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html"));

    let app = Router::new().merge(api).fallback_service(frontend).layer(CorsLayer::permissive()
                    .allow_headers(tower_http::cors::Any)
                    .allow_methods(tower_http::cors::Any))
                    .layer(axum::middleware::from_fn(set_coep_coop));

    println!("🚀  Listening on http://localhost:10001");

    let listener = tokio::net::TcpListener::bind("0.0.0.0:10001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}


async fn set_coep_coop(
    req: axum::http::Request<Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut res = next.run(req).await;
    res.headers_mut().insert(
        "Cross-Origin-Opener-Policy",
        "same-origin".parse().unwrap(),
    );
    res.headers_mut().insert(
        "Cross-Origin-Embedder-Policy",
        "require-corp".parse().unwrap(),
    );
    res
}