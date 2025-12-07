import Document, { Html, Head, Main, NextScript } from 'next/document'

class MyDocument extends Document {
  render() {
    return (
      <Html lang="fr">
        <Head>
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
            integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
            crossOrigin=""/>
          <script
            type="importmap"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                imports: {
                  "react/": "https://aistudiocdn.com/react@^19.2.1/",
                  "react": "https://aistudiocdn.com/react@^19.2.1",
                  "@google/genai": "https://aistudiocdn.com/@google/genai@^1.31.0",
                  "react-dom/": "https://aistudiocdn.com/react-dom@^19.2.1/",
                  "react-leaflet": "https://aistudiocdn.com/react-leaflet@^5.0.0",
                  "leaflet": "https://aistudiocdn.com/leaflet@^1.9.4",
                  "leaflet/": "https://aistudiocdn.com/leaflet@^1.9.4/"
                }
              })
            }}
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default MyDocument