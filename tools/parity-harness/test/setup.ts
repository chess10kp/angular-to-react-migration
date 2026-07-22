// Runs before any test/unit module imports @angular/core or react-dom.
// Installs jsdom globals, then zone.js + the Angular JIT compiler, in that order.
import { ensureAngularRuntime } from '../src/dom-env.js'

await ensureAngularRuntime()
