import React from 'react';
import ReactDOM from 'react-dom/client';
import './storage-shim.js';
import App, { PublicOsView } from './App.jsx';

const tokenPublico = new URLSearchParams(window.location.search).get('os');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {tokenPublico ? <PublicOsView token={tokenPublico} /> : <App />}
  </React.StrictMode>
);
