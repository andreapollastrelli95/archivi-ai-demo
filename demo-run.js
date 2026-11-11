/*
 * Archivi AI - modalità demo.
 * Sostituisce il server (Google Apps Script + Gemini) con un archivio nel browser:
 * gli archivi e il testo dei documenti restano in localStorage; le risposte non usano l'AI
 * ma mostrano i passaggi più pertinenti dei documenti, con la stessa citazione [documento p.N].
 */
(function () {
  var KEY = 'archivi-ai-demo';
  var EXAMPLE = {
    id: 'demo-caldaia', name: 'Caldaia (esempio)', created: 1, updated: 1,
    files: [{
      key: 'man1', id: null, name: 'Manuale caldaia Termo X200.pdf', mime: 'application/pdf', label: 'Manuale caldaia Termo X200',
      unit: 'p', pages: 4, chars: 0, note: 'documento di esempio', added: 1,
      text: [
        { p: 1, t: 'Termo X200 - caldaia a condensazione. Manuale d\'uso per l\'utente. Leggere le avvertenze di sicurezza prima dell\'uso. In caso di odore di gas chiudere il rubinetto del gas, aprire le finestre e chiamare il servizio di assistenza.' },
        { p: 2, t: 'Pressione dell\'impianto: il valore corretto a impianto freddo è tra 1 e 1,5 bar. Se la pressione scende sotto 0,8 bar sul display compare il codice E10. Per ripristinare la pressione aprire lentamente il rubinetto di carico sotto la caldaia fino a 1,2 bar, poi richiuderlo.' },
        { p: 3, t: 'Codici di errore. E10: pressione impianto bassa (vedi pagina 2). E01: mancata accensione del bruciatore; premere il tasto RESET per 3 secondi; se l\'errore si ripete chiamare l\'assistenza. E04: sonda di temperatura guasta, intervento riservato al tecnico.' },
        { p: 4, t: 'Manutenzione: la manutenzione ordinaria va eseguita una volta l\'anno da un tecnico abilitato, insieme al controllo dei fumi. Pulire il mantello esterno con un panno umido, senza solventi. Modalità estate: tenere premuto il tasto MODE fino alla comparsa del simbolo del rubinetto.' }
      ]
    }]
  };

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.archives) return s; } catch (e) { }
    return { archives: [JSON.parse(JSON.stringify(EXAMPLE))] };
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { throw new Error('Spazio del browser esaurito: elimina qualche documento.'); } }
  function pub(a) { // come restituito dal server: senza il testo dei documenti
    return { id: a.id, name: a.name, created: a.created, updated: a.updated,
      files: a.files.map(function (f) { var c = Object.assign({}, f); delete c.text; return c; }) };
  }
  function list(s) { return s.archives.map(pub); }
  function find(s, aid) {
    var a = s.archives.filter(function (x) { return x.id === aid; })[0];
    if (!a) throw new Error('Archivio non trovato.');
    return a;
  }
  function cleanName(n) {
    n = String(n || '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Error("Dai un nome all'archivio.");
    if (n.length > 60) throw new Error('Nome troppo lungo (massimo 60 caratteri).');
    return n;
  }
  function unique(s, name, skip) {
    s.archives.forEach(function (a) { if (a.id !== skip && a.name.toLowerCase() === name.toLowerCase()) throw new Error('Esiste già un archivio chiamato «' + a.name + '».'); });
  }
  function tokens(t) { return (String(t).toLowerCase().match(/[a-zà-ù0-9]+/g) || []).filter(function (w) { return w.length > 2; }).map(function (w) { return w.slice(0, 5); }); }

  var API = {
    getSettings: function () { return { hasKey: true, model: 'demo (senza AI)' }; },
    saveSettings: function () { return { hasKey: true, model: 'demo (senza AI)' }; },
    listArchives: function () { return list(load()); },
    createArchive: function (name) {
      var s = load(); name = cleanName(name); unique(s, name);
      var a = { id: 'a' + Date.now(), name: name, created: Date.now(), updated: Date.now(), files: [] };
      s.archives.push(a); save(s);
      return { id: a.id, archivi: list(s) };
    },
    renameArchive: function (aid, name) {
      var s = load(), a = find(s, aid); name = cleanName(name); unique(s, name, aid);
      a.name = name; a.updated = Date.now(); save(s);
      return { id: aid, archivi: list(s) };
    },
    deleteArchive: function (aid) {
      var s = load(); find(s, aid);
      s.archives = s.archives.filter(function (a) { return a.id !== aid; }); save(s);
      return { archivi: list(s) };
    },
    removeDocument: function (aid, fid) {
      var s = load(), a = find(s, aid);
      a.files = a.files.filter(function (f) { return f.key !== fid; }); a.updated = Date.now(); save(s);
      return { id: aid, archivi: list(s) };
    },
    addDocument: function (aid, info) {
      if (info.mode !== 'text') throw new Error('Nella demo si possono aggiungere solo file da cui il browser legge il testo (PDF con testo, Word, Excel, testo). Foto e scansioni vengono lette dall\'AI solo nella versione completa.');
      var s = load(), a = find(s, aid);
      var pages = (info.pages || []).map(function (x) { return { p: Math.floor(x.p), t: String(x.t).trim().slice(0, 30000) }; }).filter(function (x) { return x.t; });
      var stem = String(info.name || 'Documento').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_\s]+/g, ' ').trim().slice(0, 40) || 'Documento';
      a.files.push({ key: 'f' + Date.now(), id: null, name: info.name, mime: info.mime, label: stem, unit: info.unit || 'p',
        pages: info.total || pages.length, chars: pages.reduce(function (n, x) { return n + x.t.length; }, 0), note: 'solo in questo browser', added: Date.now(), text: pages });
      a.updated = Date.now(); save(s);
      return { id: aid, archivi: list(s) };
    },
    ask: function (aid, question) {
      var a = find(load(), aid), q = {};
      tokens(question).forEach(function (t) { q[t] = 1; });
      var hits = [];
      a.files.forEach(function (f) { (f.text || []).forEach(function (pg) {
        var score = tokens(pg.t).reduce(function (n, t) { return n + (q[t] ? 1 : 0); }, 0);
        if (score) hits.push({ score: score, label: f.label, p: pg.p, t: pg.t });
      }); });
      if (!a.files.length) throw new Error('Questo archivio non contiene ancora testo leggibile: aggiungi dei documenti.');
      hits.sort(function (x, y) { return y.score - x.score; });
      if (!hits.length) return 'Nei documenti di questo archivio non trovo passaggi su questa domanda.\n\n_Demo: nella versione completa risponde Google Gemini leggendo tutti i documenti._';
      return '**Passaggi più pertinenti dei documenti** (demo senza AI: nella versione completa Gemini scrive la risposta e cita le pagine):\n\n' +
        hits.slice(0, 3).map(function (h) { return '- ' + h.t + ' [' + h.label + ' p.' + h.p + ']'; }).join('\n');
    }
  };

  function runner(ok, fail) {
    return {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
      api: function (name, args) {
        setTimeout(function () {
          try { var r = API[name].apply(null, args || []); if (ok) ok(r); }
          catch (e) { if (fail) fail(e); }
        }, 150);
      }
    };
  }
  window.__run = runner(null, null);
})();
