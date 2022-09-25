# node-in-browser
An experiment to bootstrap Node.js (version 8.0.0) in the browser in order to run Node apps or npm libraries unmodified.

**See my [blog post](https://blog.cloudboost.io/how-to-run-node-js-apps-in-the-browser-3f077f34f8a5) for more info. [Try it online](https://node-in-browser.pages.dev/).**

![real node vs browser node look alike](https://cdn-images-1.medium.com/max/2000/1*BJSZn_aK5CEZ14Uis5Q4Dg.gif)

## Contributor Quick Start

``` bash
npm install
npm run build
# npm run build -- -- -w     # to build in watch mode
npm start
```

This will serve the REPL at http://localhost:8000/index.html
