/* La aplicación. Sin framework, igual que la malla: para esto no hace falta y
   un archivo que se lee de arriba abajo se arregla más rápido.

   EL ORDEN DE LAS PANTALLAS ES EL DEL PRODUCTO:
   lo que hace falta  ->  quién lo cubre  ->  lo que se publica.
   Si alguna vez una pantalla rompe ese orden, la pantalla está mal, no el orden. */
(function () {
'use strict';

var $  = function (s, d) { return (d || document).querySelector(s); };
var $$ = function (s, d) { return [].slice.call((d || document).querySelectorAll(s)); };
var esc = function (t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
};

// Estado de la sesión. Todo lo que se dibuja sale de aquí.
/* Una salida de emergencia: abrir la pagina con ?limpiar=1 borra lo guardado.

   Una sesion a medias —vencida, incompleta, escrita por una version anterior—
   deja la aplicacion intentando arreglarla en cada carga, y la persona no tiene
   forma de salir: la pantalla ni siquiera llega al boton de Salir.

   Esto corre ANTES que todo lo demas, a proposito: tiene que funcionar incluso
   si el resto esta roto. */
(function () {
  if (location.search.indexOf('limpiar=1') < 0) return;
  try {
    for (var i = window.localStorage.length - 1; i >= 0; i--) {
      var k = window.localStorage.key(i);
      if (k && k.indexOf('sb-') === 0) window.localStorage.removeItem(k);
    }
  } catch (e) {}
  try { window.sessionStorage.clear(); } catch (e) {}
  location.replace(location.pathname + '?limpio=' + Date.now());
})();

/* CUALQUIER caida se ve en pantalla.

   El 08-10 la pantalla se quedo en «Conectando…» sin mensaje, y el codigo —leido
   linea por linea— tenia que avisar: habia try/catch, habia tope de 20 segundos.
   La unica explicacion que quedaba era que algo reventara FUERA de todo eso y se
   llevara el aviso por delante.

   Un error de JavaScript que nadie ve es la peor clase de error: la pantalla se
   queda como estaba y parece que esta pensando. Esto lo saca a la luz. */
(function () {
  function mostrarCaida(texto) {
    var e = document.getElementById('eMsg');
    if (e) { e.textContent = '⚠ ' + texto; e.className = 'msg bad'; }
  }
  window.addEventListener('error', function (ev) {
    mostrarCaida((ev.message || 'error') + ' · ' + (ev.filename || '').split('/').pop()
                 + ':' + (ev.lineno || '?'));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    mostrarCaida('promesa sin atrapar · ' + ((r && (r.message || r)) || 'sin detalle'));
  });
})();

var S = {
  sesion:null, yo:null, empresa:null,
  sucursales:[], cargos:[], trabajadores:[], horarios:[],
  sucursal:null, lunes:null, vista:'semana', dia:null, agrupar:'dia', cargoGraf:null,
  necesidades:[], asignaciones:[], turnos:[],
  yoTrabajador:null,
};

/* ---------- fechas ----------
   Todo en hora de pared local, sin objetos Date con zona horaria pegada: una
   fecha aquí es el texto 'AAAA-MM-DD' y una hora es 'HH:MM'. Es lo que decidimos
   en el plan, y mezclar los dos mundos es justo donde aparecen los días corridos
   en uno. */
function hoyTexto() {
  var d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function lunesDe(texto) {
  var p = texto.split('-').map(Number);
  var d = new Date(p[0], p[1]-1, p[2]);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function masDias(texto, n) {
  var p = texto.split('-').map(Number);
  var d = new Date(p[0], p[1]-1, p[2]);
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
/* Número de semana del año, ISO-8601: la semana 1 es la del primer jueves.
   Copiado tal cual de la malla, donde ya está probado. No se reescribe algo que
   funciona solo por tenerlo en otro archivo: se reescribe y se cuelan errores de
   borde que ya estaban resueltos. */
function semanaISO(fechaIso) {
  var p = String(fechaIso).slice(0, 10).split('-').map(Number);
  var x = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) + 3);   // el jueves de esa semana
  var ene4 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  ene4.setUTCDate(ene4.getUTCDate() - ((ene4.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((x - ene4) / 604800000);
}

var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
             'septiembre','octubre','noviembre','diciembre'];
var DIAS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
function nombreDia(texto) {
  var p = texto.split('-').map(Number);
  return DIAS[(new Date(p[0], p[1]-1, p[2]).getDay() + 6) % 7];
}
function diaMes(texto) { var p = texto.split('-'); return p[2] + '/' + p[1]; }
var hhmm = function (t) { return String(t || '').slice(0,5); };

/* Horas de un tramo, descontando nada: si sale <= entra, cruza la medianoche.
   NO se calcula restando y ya: esa resta es la que da negativo en los turnos de
   noche y nadie lo ve hasta que alguien reclama su sueldo. */
/* De «HH:MM» a horas decimales. VIVE AQUÍ, no dentro de `pintarDia`.

   Estuvo anidada dentro de pintarDia y el arrastre la llamó desde fuera: una
   función anidada no existe fuera, así que `soltarTurno` reventaba con un
   ReferenceError **en silencio** —el error muere dentro del escuchador del
   evento, sin alerta y sin cambio—. Desde afuera se veía como «arrastro y no
   pasa nada», que es el peor sintoma posible: no dice dónde mirar.
   Ver `memory/funcion-anidada-pantalla-vacia.md`. */
function a2h(t) {
  var p = hhmm(t).split(':').map(Number);
  return p[0] + p[1] / 60;
}

/* Y la vuelta: de horas decimales a «HH:MM», dando la vuelta pasada la
   medianoche — una barra corrida más allá de las 24 sigue siendo una hora del
   reloj, no la hora 25.

   VIVE AQUÍ, AL LADO DE `a2h`, y eso no es orden por el orden: estuvo dentro
   del bloque del arrastre y al reescribir ese bloque **desapareció con él**.
   Las cuatro llamadas quedaron apuntando a nada y `soltarTurno` reventaba con
   un ReferenceError silencioso dentro del escuchador — el mismo síntoma de la
   mañana, «arrastro y no pasa nada», provocado esta vez por mi propio
   refactor. Una función que usan varios no puede vivir dentro de uno. */
function h2a(h) {
  var t = ((h % 24) + 24) % 24;
  var hh = Math.floor(t + 1e-9), mm = Math.round((t - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return String(hh % 24).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function horasDe(entra, sale) {
  var a = entra.split(':').map(Number), b = sale.split(':').map(Number);
  var m = (b[0]*60 + b[1]) - (a[0]*60 + a[1]);
  if (m <= 0) m += 24*60;
  return m / 60;
}

/* El color sale del CARGO, no del turno.

   Así dos turnos del mismo cargo a horas distintas se ven del mismo color, y la
   semana se lee de un vistazo sin leer texto. El número ya estaba guardado en el
   catálogo desde el primer día; solo faltaba usarlo. */
var colorCargo = function (id) {
  var q = S.cargos.filter(function (x) { return x.id === id; })[0];
  return 'c' + (((q && q.color) || 1) % 4 || 4);
};
var nombreCargo = function (id) {
  var q = S.cargos.filter(function (x) { return x.id === id; })[0];
  return q ? q.nombre : '—';
};
var nombreTrab = function (id) {
  var p = S.trabajadores.filter(function (x) { return x.id === id; })[0];
  return p ? p.nombre : '—';
};

/* ---------- DESHACER ----------

   Guarda cómo revertir las últimas diez cosas que se hicieron. Cada acción
   apunta su inversa en el momento de hacerla, que es cuando se sabe: después
   habría que adivinar qué había antes.

   DOS LÍMITES, dichos y no escondidos:
   · Deshacer un BORRADO vuelve a crear la fila, pero con un identificador
     nuevo. Para la persona es lo mismo —vuelve su turno— pero no es
     literalmente la fila de antes.
   · No deshace lo que hizo otra persona en otro computador. Es la historia de
     ESTA pantalla, no de la base.

   Si alguna vez se necesita deshacer de verdad, con varias personas a la vez,
   eso se construye en la base con la tabla `eventos` que ya se está grabando.
   Esto es el arreglo barato que sirve para el 95 % de los casos. */
var hist = [];
function recordar(texto, deshacer) {
  hist.push({ texto: texto, deshacer: deshacer });
  if (hist.length > 10) hist.shift();
  pintarDeshacer();
}
function pintarDeshacer() {
  var b = $('#btnDeshacer'); if (!b) return;
  var u = hist[hist.length - 1];
  b.disabled = !u;
  b.title = u ? 'Deshacer: ' + u.texto : 'No hay nada que deshacer';
}

function aviso(sel, texto, clase) {
  // Un mensaje de error para el reloj: si no, lo borraria al segundo siguiente.
  if (clase === 'bad' && sel === '#eMsg') pararReloj();
  var e = $(sel); if (!e) return;
  e.textContent = texto || ''; e.className = 'msg ' + (clase || '');
}

// ====================================================================
// ENTRAR
// ====================================================================
/* `entrando` evita que el arranque de la pagina pise un login en curso.

   Al cargar, `arrancar()` pregunta si hay sesion. Si esa pregunta demora y la
   persona alcanza a apretar Entrar antes de que vuelva, la respuesta («no hay
   sesion») llegaba despues y llamaba a `mostrar('entrar')`, que CANCELABA el
   aviso de los 15 segundos recien armado. La pantalla quedaba en «Entrando…»
   en gris para siempre, sin error y sin tope.

   En mi navegador la pregunta volvia antes de que yo enviara el formulario, asi
   que no se reproducia. En el de Pedro, si. */
var entrando = false;

function mostrar(cual) {
  // El tope solo se cancela cuando de verdad salimos del login.
  if (cual !== 'entrar') { clearTimeout(window.__tope); entrando = false; }
  pararReloj();
  /* Y SE BORRA EL MENSAJE.

     Esto fue media tarde de confusión. Al abrir la página sin sesión, el código
     escribía «Buscando tu cuenta…» y enseguida mostraba el formulario… pero
     dejaba ese texto puesto. Quedaba ahí, fijo, bajo un formulario que estaba
     perfectamente usable, y parecía un cuelgue. Pedro me mandó cinco fotos de
     eso y las cinco veces busqué el problema en la red, en la biblioteca y en
     su navegador. El problema era que yo no borraba un texto. */
  aviso('#eMsg', '');
  $('#p-entrar').hidden  = cual !== 'entrar';
  $('#p-primera').hidden = cual !== 'primera';
  $('#app').hidden       = cual !== 'app';
}

$('#formEntrar').addEventListener('submit', function (ev) {
  ev.preventDefault();
  /* TODO dentro de un try.

     `DATOS.auth.entrar` empieza con codigo que corre AL TIRO —construir el
     cliente—, no dentro de una promesa. Si eso lanzaba (por ejemplo, porque la
     biblioteca no habia cargado), la excepcion se escapaba del manejador entero
     y NINGUN `.catch` la veia: la pantalla se quedaba en «Entrando…» sin decir
     nada. Un error que no se puede ver es peor que uno feo. */
  try { entrarDeVerdad(); } catch (e) { entrando = false; aviso('#eMsg', e.message, 'bad'); }
});

function entrarDeVerdad() {
  var email = $('#eMail').value.trim(), clave = $('#eClave').value;
  entrando = true;
  paso('Conectando…', generacion);
  // Si en 15 segundos no pasó nada, decirlo. Un colgado callado se ve idéntico
  // a algo que está tardando, y la persona se queda mirando sin saber cuál es.
  clearTimeout(window.__tope);
  window.__tope = setTimeout(function () {
    if (/Conectando|Entrando|Verificando|Buscando|Cargando|Dibujando/.test($('#eMsg').textContent))
      aviso('#eMsg', 'Está tardando demasiado en «' + $('#eMsg').textContent.replace('…','')
                   + '». Mándame esta pantalla.', 'bad');
  }, 15000);
  DATOS.auth.entrar(email, clave)
    // Se le pasa la sesion que ACABA de llegar en vez de volver a pedirla.
    // Pedirla aqui dejaba la pantalla colgada en «Entrando…» para siempre: la
    // biblioteca toma un candado para hacer el login y preguntarle por la sesion
    // antes de que lo suelte es esperar a quien esta esperando que termines.
    // Ademas es lo obvio: ya la tenemos en la mano.
    .then(function (d) { return arrancar(d && d.session); })
    .catch(function (e) { entrando = false; aviso('#eMsg', traducir(e.message), 'bad'); });
}

$('#btnRegistrar').addEventListener('click', function () {
  var email = $('#eMail').value.trim(), clave = $('#eClave').value;
  if (!email || clave.length < 6)
    return aviso('#eMsg', 'Pon tu correo y una contraseña de al menos 6 caracteres.', 'bad');
  aviso('#eMsg', 'Creando la cuenta…');
  DATOS.auth.registrar(email, clave).then(function (r) {
    // Si el proyecto pide confirmar por correo, NO hay sesión todavía. Decirlo
    // claro: si no, la pantalla se queda igual y parece que no pasó nada.
    if (r && r.session) return arrancar(r.session);
    aviso('#eMsg', 'Cuenta creada. Revisa tu correo para confirmarla y después entra.', 'ok');
  }).catch(function (e) { aviso('#eMsg', traducir(e.message), 'bad'); });
});

// Los mensajes de Supabase vienen en inglés y de fábrica. Los tres que de
// verdad le van a salir a alguien se traducen; el resto pasa tal cual, porque
// inventar una traducción esconde el problema.
function traducir(m) {
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/already registered/i.test(m))        return 'Ese correo ya tiene cuenta. Entra en vez de crearla.';
  if (/Email not confirmed/i.test(m))       return 'Falta confirmar el correo. Revisa tu bandeja.';
  return m;
}

$('#formPrimera').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var nombre = $('#pNombre').value.trim();
  if (!nombre) return;
  aviso('#pMsg', 'Creando…');
  DATOS.primeraVez(nombre)
    .then(arrancar)
    .catch(function (e) { aviso('#pMsg', e.message, 'bad'); });
});

$$('#btnSalir, #btnSalir1').forEach(function (b) {
  b.addEventListener('click', function () { DATOS.auth.salir().then(function () { location.reload(); }); });
});

// ====================================================================
// ARRANQUE
// ====================================================================
/* El mensaje dice EN QUE PASO va.

   Toda la tarde del 08-10 se fue en no saber donde se detenia: «Entrando…» es
   lo mismo si falla la red, si falla la consulta o si falla el dibujo. Con el
   paso a la vista, una foto lo dice.

   Vale para la persona tambien: «buscando tu cuenta» es informacion, «Entrando»
   repetido treinta segundos es angustia. */
/* UN SOLO ARRANQUE A LA VEZ.

   `arrancar()` corre al cargar la pagina Y otra vez al entrar. Las dos cadenas
   quedaban vivas a la vez y se pisaban el mensaje: cuando la primera fallaba y
   mostraba el error en rojo, la segunda lo sobrescribia con su «Cargando tus
   datos…» en gris. Pedro veia un cuelgue mudo y yo veia un codigo que, leido,
   tenia que avisar. Los dos teniamos razon.

   Cada arranque toma un numero. El que ya no es el ultimo se calla: no escribe
   en la pantalla ni la cambia de sitio. */
var generacion = 0;

/* El paso muestra los segundos que lleva.

   No es decoracion: si el numero avanza, los temporizadores del navegador
   corren y el problema es la peticion. Si el numero se queda congelado, la
   pagina entera esta detenida y el problema es otro completamente distinto.
   Una foto responde cual de los dos, sin preguntarle nada a nadie.

   Y para quien usa la app, ver «(3 s)» es muy distinto de ver un texto fijo:
   lo primero es algo trabajando, lo segundo parece roto. */
var reloj = null, desde = 0, textoPaso = '';
function paso(txt, mia) {
  if (mia !== undefined && mia !== generacion) return;
  if ($('#p-entrar').hidden) return;
  textoPaso = txt; desde = Date.now();
  clearInterval(reloj);
  var pintar = function () {
    var s = Math.round((Date.now() - desde) / 1000);
    aviso('#eMsg', textoPaso + (s >= 2 ? '  (' + s + ' s)' : ''));
  };
  pintar();
  reloj = setInterval(pintar, 1000);
}
function pararReloj() { clearInterval(reloj); reloj = null; }

function arrancar(sesionYaTengo) {
  var mia = ++generacion;
  var vigente = function () { return mia === generacion; };
  paso('Verificando la sesión…', mia);
  var paso0 = sesionYaTengo ? Promise.resolve(sesionYaTengo) : DATOS.auth.sesion();
  return paso0.then(function (ses) {
    if (!vigente()) return;
    // Si llega tarde y ya hay alguien entrando, no toca la pantalla.
    // Y se comprueba ANTES de anunciar el paso: anunciar «buscando tu cuenta»
    // cuando no hay ninguna sesión que buscar es prometer trabajo que no se va
    // a hacer, y deja a la persona esperando algo que nunca iba a pasar.
    if (!ses) { if (!entrando) mostrar('entrar'); return; }
    paso('Buscando tu cuenta…', mia);
    S.sesion = ses;
    return DATOS.yo().then(function (u) {
      if (!vigente()) return;
      if (!u) { mostrar('primera'); return; }
      S.yo = u;
      paso('Cargando tus datos…', mia);
      return cargarTodo(mia).then(function () { if (vigente()) mostrar('app'); })
        .catch(function (e) {
          if (!vigente()) return;
          entrando = false; aviso('#eMsg', e.message, 'bad');
        });
    });
  }).catch(function (e) {
    if (!vigente()) return;
    mostrar('entrar');
    aviso('#eMsg', e.message, 'bad');
  });
}

function cargarTodo(mia) {
  return Promise.all([
    DATOS.sucursales.listar(), DATOS.cargos.listar(),
    DATOS.trabajadores.listar(), DATOS.horarios.listar(),
  ]).then(function (r) {
    S.sucursales = r[0]; S.cargos = r[1]; S.trabajadores = r[2]; S.horarios = r[3];
    // Se pregunta una sola vez y no se bloquea el arranque con esto: si la
    // respuesta llega tarde, la app ya esta pintada y solo cambia que la ficha
    // del local muestre los campos o el aviso de la migracion pendiente.
    if (DATOS.sucursales.hayHorario) {
      DATOS.sucursales.hayHorario().then(function (hay) {
        if (S.hayHorarioLocal !== hay) { S.hayHorarioLocal = hay; pintarConfig(); }
      });
    }
    if (DATOS.horarios.hayPorLocal) {
      DATOS.horarios.hayPorLocal().then(function (hay) {
        if (S.hayAtajoPorLocal !== hay) { S.hayAtajoPorLocal = hay; pintarConfig(); }
      });
    }
    S.yoTrabajador = S.trabajadores.filter(function (p) { return p.usuario_id === S.yo.id; })[0] || null;
    $('#hEmpresa').textContent = 'Turnos';
    $('#hQuien').textContent = S.yo.email;
    if (!S.sucursal) S.sucursal = (S.sucursales[0] || {}).id || null;
    if (!S.lunes) S.lunes = lunesDe(hoyTexto());
    if (!S.dia) S.dia = hoyTexto();
    pintarSelectores();
    pintarEquipo(); pintarConfig();
    return recargarSemana();
  });
}

function pintarSelectores() {
  var sel = $('#cSucursal');
  sel.innerHTML = S.sucursales.map(function (s) {
    return '<option value="' + s.id + '">' + esc(s.nombre) + '</option>';
  }).join('');
  if (S.sucursal) sel.value = S.sucursal;
  var c = $('#cSemana');
  if (S.vista === 'dia') {
    c.innerHTML = '<b>' + nombreDia(S.dia) + '</b> ' + diaMes(S.dia)
                + ' <span class="numsem">Semana ' + semanaISO(S.dia) + '</span>';
  } else if (S.vista === 'mes') {
    var p = S.lunes.split('-').map(Number);
    c.innerHTML = '<b>' + MESES[p[1] - 1] + '</b> ' + p[0];
  } else {
    c.innerHTML = diaMes(S.lunes) + ' — ' + diaMes(masDias(S.lunes, 6))
                + ' <span class="numsem">Semana ' + semanaISO(S.lunes) + '</span>';
  }
  $$('#cVista button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.v === S.vista));
  });
  $$('#cAgrupar button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.g === S.agrupar));
  });
}

function recargarSemana() {
  if (!S.sucursal) {
    $('#malla').innerHTML = '';
    return avisoPlan('Todavía no tienes ningún local. Créalo en <b>Configuración</b>.');
  }
  if (!S.cargos.length)
    avisoPlan('Todavía no tienes cargos. Créalos en <b>Equipo</b>: sin cargos no se puede decir qué hace falta.');
  else avisoPlan(null);

  var r = rangoVista();
  var desde = r.desde, hasta = r.hasta;
  return Promise.all([
    DATOS.necesidades.listar(S.sucursal, desde, hasta),
    DATOS.asignaciones.listar(S.sucursal, desde, hasta),
    DATOS.turnos.listar(S.sucursal, desde, hasta),
  ]).then(function (r) {
    S.necesidades = r[0]; S.asignaciones = r[1]; S.turnos = r[2];
    pintarMalla();
  }).catch(function (e) { avisoPlan('No pude cargar la semana: ' + esc(e.message)); });
}

/* Qué trae la base según la vista. Un día, una semana o el mes entero — y el
   mes se pide COMPLETO, incluidos los días de relleno del principio y el final,
   porque si no, la primera y la última fila salen vacías sin motivo. */
function rangoVista() {
  if (S.vista === 'dia') return { desde: S.dia, hasta: S.dia };
  if (S.vista === 'mes') {
    var p = S.lunes.split('-').map(Number);
    var primero = new Date(p[0], p[1] - 1, 1);
    var ini = new Date(primero);
    ini.setDate(1 - ((primero.getDay() + 6) % 7));
    var fin = new Date(p[0], p[1], 0);                 // último día del mes
    fin.setDate(fin.getDate() + (6 - ((fin.getDay() + 6) % 7)));
    var t = function (d) {
      return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'),
              String(d.getDate()).padStart(2,'0')].join('-');
    };
    return { desde: t(ini), hasta: t(fin) };
  }
  return { desde: S.lunes, hasta: masDias(S.lunes, 6) };
}

function avisoPlan(html) {
  var e = $('#avisoPlan');
  e.hidden = !html; e.innerHTML = html || '';
}

// ====================================================================
// LA MALLA
// ====================================================================
function pintarMalla() {
  // Agrupar por persona o por cargo da vuelta la tabla: las filas dejan de ser
  // días y pasan a ser gente o cargos. En la vista Mes no se ofrece: 31 columnas
  // no se leen, y fingir que sí es peor que no tenerlo.
  //
  // EL DÍA SIEMPRE ES LÍNEA DE TIEMPO, se agrupe como se agrupe (09-10).
  // Antes esta función preguntaba primero por la agrupación, así que «Personas»
  // y «Cargos» en la vista Día caían en la tabla de fichas y la rama por persona
  // de pintarDia() —escrita desde el principio— no se ejecutaba nunca.
  // Verificado contra las capturas de Skello: su regla de horas vive solo en la
  // vista Día, y ahí las solapas Employés|Postes siguen mostrando barras.
  if (S.vista === 'dia') return pintarDia();
  if (S.vista === 'mes') return pintarMes();
  if (S.agrupar !== 'dia') return pintarGirada();
  pintarSemana();
}

/* La celda de un día es la MISMA en las tres vistas. Si se escribiera tres
   veces, cada arreglo habría que hacerlo tres veces y una se olvidaría — que es
   exactamente como se cuelan los defectos de «la mitad de los sitios». */
function celdaDia(f, hoy, compacta) {
  var necs = S.necesidades.filter(function (n) { return n.fecha === f; });
  var sueltas = S.asignaciones.filter(function (a) { return a.fecha === f && !a.necesidad_id; });
  var html = '<div class="dia' + (f === hoy ? ' hoy' : '') + (compacta ? ' chico' : '') + '">'
    + '<header><b>' + (compacta ? f.split('-')[2] : nombreDia(f)) + '</b>'
    + '<span class="num">' + (compacta ? '' : diaMes(f)) + '</span></header>'
    + '<div class="cuerpo">';
  necs.forEach(function (n) { html += pintarNecesidad(n); });
  sueltas.forEach(function (a) { html += pintarSuelta(a); });
  html += '<button class="mas" data-nueva="' + f + '">+ qué hace falta</button>';
  if (!compacta) html += '<button class="mas" data-suelta="' + f + '">+ turno suelto</button>';
  return html + '</div></div>';
}

function pintarSemana() {
  var hoy = hoyTexto(), html = '';
  for (var i = 0; i < 7; i++) html += celdaDia(masDias(S.lunes, i), hoy, false);
  var m = $('#malla');
  m.className = 'malla';
  m.innerHTML = html;
  pintarPie();
  $('#cEstado').textContent = resumenPublicar();
}

/* Las horas que llevas puestas, por día y en total.

   Skello la tiene al pie de la malla («Heures travaillées») y es de las cosas
   que más se usan sin darse cuenta: mientras repartes gente, ves cuántas horas
   estás comprometiendo. Las horas son plata, y verlas DESPUÉS, en un informe,
   llega tarde para corregir.

   Se cuenta solo lo que tiene persona: un turno pendiente no son horas de
   nadie todavía. */
function horasDeDia(f) {
  return S.asignaciones.reduce(function (t, a) {
    if (a.fecha !== f || !a.trabajador_id) return t;
    return t + horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin));
  }, 0);
}
function numero(h) {
  return (Math.round(h * 10) / 10).toString().replace('.', ',');
}
function pintarPie() {
  var pie = $('#pieHoras');
  if (!pie) return;
  if (S.vista !== 'semana') { pie.hidden = true; return; }
  var total = 0, celdas = '';
  for (var i = 0; i < 7; i++) {
    var f = masDias(S.lunes, i), h = horasDeDia(f);
    total += h;
    celdas += '<span' + (h ? '' : ' class="cero"') + '><b>' + nombreDia(f).slice(0, 3) + '</b>'
            + (h ? numero(h) + ' h' : '—') + '</span>';
  }
  pie.hidden = false;
  pie.innerHTML = '<span class="prot">Horas repartidas</span>' + celdas
                + '<span class="ptot"><b>Semana</b>' + numero(total) + ' h</span>';
}

/* EL DÍA ES UNA LÍNEA DE TIEMPO, no una lista.

   Pedro lo dijo del producto nuevo —«no se ve como carta Gantt»— y es la misma
   corrección que ya había hecho en la malla, donde quedó escrito así: «un día
   no es una lista. Lo único que de verdad importa mirar en un día es DÓNDE
   QUEDAN HUECOS, y con tarjetas había que calcularlo».

   Con las horas corriendo de izquierda a derecha, el hueco entre un turno que
   termina a las 16:30 y otro que entra a las 17:00 SE VE. No hay que leer dos
   números y restarlos.

   Criterio que dejó esa vez y vale igual acá: cuando alguien no entiende una
   pantalla y existe un formato mejor, la confusión ES el defecto. No se explica
   mejor: se cambia. */
function pintarDia() {
  var m = $('#malla');
  var delDia = S.asignaciones.filter(function (a) { return a.fecha === S.dia; });
  var necsDia = S.necesidades.filter(function (n) { return n.fecha === S.dia; });

  // La franja horaria sale de lo que hay ese día, no de un horario inventado:
  // un local que abre a las 20:00 no quiere ver diez columnas vacías de mañana.
  var hs = [];
  delDia.concat(necsDia).forEach(function (x) {
    var i = a2h(x.hora_inicio), f = a2h(x.hora_fin);
    if (f <= i) f += 24;                     // cruza la medianoche
    hs.push(i, f);
  });
  /* LA FRANJA SE AJUSTA AL DÍA, como Skello — sin horas muertas.

     Ellos usan 07h–20h. Nosotros no fijamos esas horas: las sacamos de lo que
     hay ese día, con DOS HORAS DE AIRE a cada lado. Fijar 07–20 dejaría fuera a
     un bar que abre a las 20:00, y este producto no es solo para restoranes de
     almuerzo.

     El aire importa: pegada a los turnos, una jornada de 09 a 17 se dibujaba
     justo de 09 a 17, las barras tocaban los bordes y parecía que el día estaba
     lleno. Con el margen se ve que después de las 17 queda tarde por cubrir.

     Y un mínimo de diez horas, porque una franja de tres no se lee.
     Si un turno cruza la medianoche, la franja se estira hasta donde termine:
     ese turno existe y tiene que verse entero, no cortado en el borde. */
  /* EL MARCO DEL DÍA: primero el horario del local, si está puesto.

     Deducir la franja de los turnos tiene un problema que solo se ve
     comparando dos días: cada día se dibuja a su propia escala, así que un día
     con un turno de 09 a 13 se ve IGUAL DE LLENO que uno de 08 a 23. Con el
     horario del local, todos los días del mismo local se miden con la misma
     vara y recién ahí «lleno» y «vacío» quieren decir algo.

     Si no está puesto —o falta la migración— se sigue deduciendo, igual que
     antes. Esto no puede romperse por un dato que nadie escribió todavía. */
  var loc = S.sucursales.filter(function (x) { return x.id === S.sucursal; })[0] || {};
  var ini, fin;
  if (loc.abre && loc.cierra) {
    ini = Math.floor(a2h(loc.abre));
    fin = Math.ceil(a2h(loc.cierra));
    if (fin <= ini) fin += 24;              // el local cierra de madrugada
    /* Un turno fuera del horario del local NO se recorta: existe y tiene que
       verse entero. El horario es el marco de referencia, no una tijera —si
       alguien quedó anotado a las 06:00 en un local que abre a las 08:00, eso
       es justo lo que hay que poder ver. */
    if (hs.length) {
      ini = Math.min(ini, Math.floor(Math.min.apply(null, hs)));
      fin = Math.max(fin, Math.ceil(Math.max.apply(null, hs)));
    }
    ini = Math.max(0, ini);
  } else {
    ini = hs.length ? Math.max(0, Math.floor(Math.min.apply(null, hs)) - 2) : 8;
    fin = hs.length ? Math.ceil(Math.max.apply(null, hs)) + 2 : 20;
  }
  if (fin - ini < 10) {
    ini = Math.max(0, ini - Math.floor((10 - (fin - ini)) / 2));
    fin = ini + 10;
  }
  var ancho = fin - ini;
  var pct = function (h) { return ((h - ini) / ancho) * 100; };

  // Las filas siguen lo que esté elegido arriba: gente, cargos o lo planificado.
  var filas;
  if (S.agrupar === 'persona') {
    filas = S.trabajadores.map(function (p) { return { id: p.id, nombre: p.nombre,
      suyas: delDia.filter(function (x) { return x.trabajador_id === p.id; }) }; });
    /* LO PENDIENTE NO SE ESCONDE: su propia fila al final, como en la tabla
       girada. Sin esto, agrupar por persona hacía DESAPARECER los turnos sin
       dueño —no hay fila a la que pertenezcan— y el día se veía cubierto
       cuando no lo estaba. Es el mismo criterio que ya está en pintarGirada(). */
    filas.push({ id: null, nombre: 'Sin asignar', suelto: true,
      suyas: delDia.filter(function (x) { return !x.trabajador_id; }) });
  } else {
    filas = S.cargos.map(function (q) { return { id: q.id, nombre: q.nombre,
      suyas: delDia.filter(function (x) { return x.cargo_id === q.id; }),
      pide: necsDia.filter(function (n) { return n.cargo_id === q.id; }) }; });
  }
  filas = filas.filter(function (f) { return f.suyas.length || (f.pide && f.pide.length); });

  /* EL ORDEN DE LAS BARRAS DENTRO DE UN GRUPO: POR IDENTIDAD, NO POR HORA.

     Esto cambió dos veces y conviene que quede el porqué.

     Primero salían en el orden en que volvían de la base, que cambia al
     guardar: movías una barra y al repintar aparecía en otra línea
     (Pedro: «beto pasó donde estaba ana»). Lo ordené **por hora de entrada**,
     que es determinista… y seguía saltando: si al arrastrar cruzas la hora de
     la vecina, las dos se cambian de línea en medio del gesto
     (Pedro: «ana y beto cambian de posicion con algunos movimientos»).

     **Lo que el usuario tiene agarrado no se puede mover solo.** Por eso el
     orden va por `id`: no significa nada, pero no cambia nunca — y aquí eso
     vale más que la prolijidad, porque la hora ya se lee en el eje horizontal,
     que es para lo que existe una línea de tiempo. La fila vertical no tiene
     que contar la misma historia dos veces. */
  var porId = function (x, y) { return String(x.id) < String(y.id) ? -1 : 1; };
  filas.forEach(function (f) {
    f.suyas.sort(porId);
    if (f.pide) f.pide.sort(porId);
  });

  // Si la franja es larga, las horas impares quedan como rayita para que los
  // números no se amontonen; si es corta, se rotulan todas.
  var saltar = ancho > 14;
  var horas = '';
  for (var h = ini; h <= fin; h++) {
    var muda = saltar && (h % 2);
    horas += '<span class="marca' + (muda ? ' muda' : '') + '" style="left:' + pct(h) + '%">'
           + (muda ? '' : String(h % 24).padStart(2, '0')) + '</span>';
  }

  /* EL GRÁFICO DE NECESIDAD POR HORA.

     Una línea con lo que hace falta y barras con lo que hay puesto, hora por
     hora. Es lo que Skello pone sobre la línea de tiempo, y resuelve algo que
     las bandas no podían: la banda dice «hacen falta 3» para todo el tramo,
     pero si una persona se va a las 13:00 el hueco cambia de tamaño a esa hora
     y la banda sigue diciendo lo mismo.

     LO PUESTO NO SE ESCRIBE: se cuenta de los turnos asignados. Lo único que se
     teclea es la necesidad. Si se escribieran los dos, el día que no coincidan
     habría que decidir cuál miente.

     Y es de UN CARGO a la vez: mezclar todos en una línea no dice nada — que
     falte un cocinero no es lo mismo que falte un cajero. */
  /* Ojo con el id: de la necesidad se toma su CARGO, no su propio identificador.
     La primera versión ponía `necsDia[0].id` —el id de la necesidad— como cargo
     elegido. El selector no encontraba esa opción, el navegador mostraba la
     primera de la lista, y el gráfico salía plano en cero contando turnos de un
     cargo que no existe. En el código se veía perfecto. */
  if (!S.cargoGraf || !S.cargos.some(function (q) { return q.id === S.cargoGraf; }))
    S.cargoGraf = (necsDia[0] ? necsDia[0].cargo_id : (S.cargos[0] || {}).id) || null;

  var html = '';
  if (S.cargoGraf) {
    var cuenta = function (lista, h) {
      return lista.filter(function (x) {
        var i = a2h(x.hora_inicio), f = a2h(x.hora_fin); if (f <= i) f += 24;
        return x.cargo_id === S.cargoGraf && i <= h && h < f;
      });
    };
    var necH = [], pueH = [], tope = 1;
    for (var h = ini; h < fin; h++) {
      var n = cuenta(necsDia, h).reduce(function (t, x) { return t + x.personas_requeridas; }, 0);
      var p = cuenta(delDia.filter(function (x) { return x.trabajador_id; }), h).length;
      necH.push(n); pueH.push(p);
      tope = Math.max(tope, n, p);
    }
    var alto = 92, y = function (v) { return alto - (v / tope) * (alto - 14); };
    var anchoH = 100 / ancho, g = '';
    for (var v = 0; v <= tope; v++) {
      g += '<span class="guia" style="top:' + y(v) + 'px"></span>'
         + '<span class="guian" style="top:' + (y(v) - 8) + 'px">' + v + '</span>';
    }
    necH.forEach(function (n, k) {
      if (pueH[k]) g += '<span class="gb" style="left:' + (pct(ini + k) + anchoH * 0.1)
        + '%;width:' + (anchoH * 0.8) + '%;top:' + y(pueH[k]) + 'px;height:'
        + (alto - y(pueH[k])) + 'px"></span>';
    });
    var ant = null;
    necH.forEach(function (n, k) {
      g += '<span class="gl" style="left:' + pct(ini + k) + '%;width:' + anchoH
         + '%;top:' + (y(n) - 1) + 'px"></span>';
      if (ant !== null && ant !== n) {
        var arr = Math.min(y(ant), y(n)), aba = Math.max(y(ant), y(n));
        g += '<span class="glv" style="left:' + pct(ini + k) + '%;top:' + arr
           + 'px;height:' + (aba - arr) + 'px"></span>';
      }
      ant = n;
    });

    html += '<div class="linea grafcaja">'
      + '<div class="gtop"><select id="cCargoGraf">'
      + S.cargos.map(function (q) {
          return '<option value="' + q.id + '"' + (q.id === S.cargoGraf ? ' selected' : '') + '>'
               + esc(q.nombre) + '</option>';
        }).join('')
      + '</select><span class="gley"><i><span class="mu"></span>hacen falta</i>'
      + '<i><span class="mb"></span>hay puestos</i></span></div>'
      + '<div class="gcaja"><span class="lrot"></span>'
      + '<div class="graf" style="height:' + alto + 'px">' + g + '</div></div>'
      + '<div class="lcab"><span class="lrot"></span><div class="lhoras">' + horas + '</div></div>'
      + '</div>';
  }

  /* La franja viaja en el HTML: al soltar hace falta convertir una posición en
     hora, y eso necesita `ini` y `fin`. Leerlos del DOM evita tener que
     acordarse de pasarlos — y de que un día no coincidan con lo dibujado. */
  html += '<div class="linea" data-ini="' + ini + '" data-fin="' + fin + '">'
           + '<div class="lcab"><span class="lrot"></span>'
           + '<div class="lhoras">' + horas + '</div></div>';

  if (!filas.length) {
    html += '<p class="vacio">Nada planificado este día. Usa «+ qué hace falta» abajo.</p>';
  }

  /* UNA LÍNEA POR TURNO, no todos apilados en la misma.

     La primera versión los ponía a todos en una sola línea y se tapaban: Beto
     de 09 a 17 y Ana de 09 a 13 se veían como UNA barra continua de 09 a 17 con
     el nombre de Ana. Dos turnos distintos leídos como uno — justo lo contrario
     de lo que una línea de tiempo tiene que mostrar. Lo vi al mirar la captura;
     el conteo de barras decía 3 y parecía correcto. */
  filas.forEach(function (f) {
    // Primero lo PEDIDO, de fondo: el trozo sin cubrir queda a la vista.
    if (f.pide && f.pide.length) {
      html += '<div class="lfila" data-fila="' + (f.id || '') + '">'
            + '<span class="lrot">' + esc(f.nombre) + '</span><div class="lpista">';
      f.pide.forEach(function (n) {
        var i = a2h(n.hora_inicio), ff = a2h(n.hora_fin); if (ff <= i) ff += 24;
        html += '<span class="lpide" style="left:' + pct(i) + '%;width:' + (pct(ff) - pct(i)) + '%"'
              + ' title="Hacen falta ' + n.personas_requeridas + '">'
              + '<span class="lpidetxt">hacen falta ' + n.personas_requeridas + '</span></span>';
      });
      html += '</div></div>';
    }
    f.suyas.forEach(function (x, k) {
      var i = a2h(x.hora_inicio), ff = a2h(x.hora_fin); if (ff <= i) ff += 24;
      /* La barra dice la OTRA cara del turno, no la de la fila.

         Agrupado por persona, la fila ya es «Ana»: repetir «Ana» en la barra
         gasta el único lugar donde cabía el dato que falta —en qué está—.
         Es la misma regla del bloque de la semana (A1). Lo preguntó Pedro
         viendo la vista en vivo: «¿acá debería poder saber si Ana está en
         cocina u otra cosa?». */
      var quien = x.trabajador_id ? nombreTrab(x.trabajador_id) : 'pendiente';
      var rotulo = S.agrupar === 'persona' ? nombreCargo(x.cargo_id) : quien;
      // El nombre del grupo solo en la primera línea, si no hay fila de pedido.
      var rot = (!f.pide || !f.pide.length) && k === 0 ? esc(f.nombre) : '';
      html += '<div class="lfila" data-fila="' + (f.id || '') + '">'
            + '<span class="lrot chico">' + rot + '</span><div class="lpista">'
            + '<span class="lbarra ' + colorCargo(x.cargo_id) + (x.trabajador_id ? '' : ' sinnadie')
            + '" data-asigid="' + x.id + '"'
            + ' style="left:' + pct(i) + '%;width:' + (pct(ff) - pct(i)) + '%"'
            + ' title="' + esc(quien) + ' · ' + esc(nombreCargo(x.cargo_id)) + ' · '
            + hhmm(x.hora_inicio) + '–' + hhmm(x.hora_fin) + '">'
            + '<b>' + esc(rotulo) + '</b> <i>' + hhmm(x.hora_inicio) + '–' + hhmm(x.hora_fin) + '</i>'
            // Una tira a cada borde para estirar. Van DENTRO de la barra para
            // que se muevan con ella sin tener que recalcular nada.
            + '<span class="tirador izq"></span><span class="tirador der"></span>'
            + '</span></div></div>';
    });
  });

  html += '</div>' + celdaDia(S.dia, hoyTexto(), false);
  m.className = 'malla undia';
  pintarPie();
  m.innerHTML = html;
  engancharGestosDia(m);
  $('#cEstado').textContent = resumenPublicar();
}

/* ====================================================================
   MOVER Y ESTIRAR UNA BARRA — UN SOLO MECANISMO, EVENTOS DE PUNTERO

   La primera versión usaba el arrastre nativo del navegador para mover y
   eventos de puntero para estirar. Pedro lo probó y lo dijo exacto:
   «se queda medio pegado, avanza pero no se mueve». Es el síntoma clásico del
   arrastre nativo — lo que sigue al cursor es una SILUETA FANTASMA que pinta
   el navegador; la barra de verdad se queda quieta hasta que sueltas. Encima
   el gesto compite con el de estirar, y había que ir apagando `draggable`
   para que no se pelearan.

   Ahora los dos gestos son lo mismo: se toma la barra, SE MUEVE LA BARRA, y
   se ve dónde va a quedar antes de soltar. Lo que gana:
   · La barra sigue al dedo de verdad, sin fantasma ni retardo.
   · Funciona igual con mouse, lápiz y dedo (el nativo no anda en táctil).
   · Un solo mecanismo, así que nada que coordinar entre dos.

   Un clic sin mover sigue abriendo la ficha: el gesto no arranca hasta que el
   puntero se corre 3 px, y así un dedo poco firme no convierte un clic en un
   arrastre accidental. */
var SALTO  = 0.25;   // 15 minutos
var MINIMO = 0.25;   // ningún turno más corto que eso
var UMBRAL = 3;      // px antes de considerar que esto es un arrastre

function engancharGestosDia(caja) {
  if (!caja || caja.dataset.gestos) return;
  caja.dataset.gestos = '1';
  var g = null;
  var tragarClic = false;

  var pct = function (h, h0, h1) { return ((h - h0) / (h1 - h0)) * 100; };
  var horaEn = function (g, clientX) {
    var r = g.pista.getBoundingClientRect(); if (!r.width) return null;
    return g.h0 + ((clientX - r.left) / r.width) * (g.h1 - g.h0);
  };

  caja.addEventListener('pointerdown', function (ev) {
    if (ev.button != null && ev.button !== 0) return;
    var b = ev.target.closest && ev.target.closest('.lbarra[data-asigid]');
    if (!b) return;
    var pista = b.closest('.lpista'), linea = pista && pista.closest('.linea');
    if (!pista || !linea) return;
    var a = S.asignaciones.filter(function (x) { return x.id === b.dataset.asigid; })[0];
    if (!a) return;
    var i = a2h(a.hora_inicio), f = a2h(a.hora_fin); if (f <= i) f += 24;
    var tir = ev.target.closest('.tirador');
    g = {
      b: b, pista: pista, id: a.id, activo: false,
      modo: tir ? (tir.classList.contains('izq') ? 'izq' : 'der') : 'mover',
      h0: Number(linea.dataset.ini), h1: Number(linea.dataset.fin),
      ini: i, fin: f, iniOrig: i, finOrig: f,
      x0: ev.clientX, fila: null,
    };
    // Dónde se agarró la barra, para que no salte bajo el cursor al empezar.
    g.agarre = horaEn(g, ev.clientX) - i;
    /* OJO: NADA de `preventDefault()` aquí.

       Lo tenía, para que no se seleccionara texto al arrastrar, y me costó un
       defecto: `preventDefault` en el `pointerdown` suprime los eventos de
       ratón que vienen después — incluido el `click`—, así que **apretar una
       barra dejó de abrir la ficha**. La selección de texto se evita con CSS
       (`user-select:none`), que no tiene ese efecto secundario. */
    try { b.setPointerCapture(ev.pointerId); } catch (e) {}
  });

  caja.addEventListener('pointermove', function (ev) {
    if (!g) return;
    if (!g.activo) {
      if (Math.abs(ev.clientX - g.x0) < UMBRAL) return;   // todavía es un clic
      g.activo = true;
      // Recién aquí, cuando ya es un arrastre de verdad y no un clic.
      if (ev.cancelable) ev.preventDefault();
      g.b.classList.add(g.modo === 'mover' ? 'llevando' : 'estirando');
      // Mientras se mueve, la barra no estorba: así se puede saber qué fila
      // hay DEBAJO del cursor para soltarla ahí.
      if (g.modo === 'mover') g.b.style.pointerEvents = 'none';
    }
    var h = horaEn(g, ev.clientX);
    if (h == null) return;

    if (g.modo === 'mover') {
      var dur = g.finOrig - g.iniOrig;
      g.ini = Math.round((h - g.agarre) / SALTO) * SALTO;
      if (g.ini < 0) g.ini = 0;
      g.fin = g.ini + dur;
      // La fila de debajo se marca: con filas de 24 px, errarle por una es fácil.
      var bajo = document.elementFromPoint(ev.clientX, ev.clientY);
      var fila = bajo && bajo.closest && bajo.closest('.lfila');
      if (fila !== g.fila) {
        caja.querySelectorAll('.lpista.encima').forEach(function (x) { x.classList.remove('encima'); });
        g.fila = fila;
        var p2 = fila && fila.querySelector('.lpista');
        if (p2) p2.classList.add('encima');
      }
    } else if (g.modo === 'izq') {
      g.ini = Math.min(Math.round(h / SALTO) * SALTO, g.fin - MINIMO);
    } else {
      g.fin = Math.max(Math.round(h / SALTO) * SALTO, g.ini + MINIMO);
    }

    g.b.style.left  = pct(g.ini, g.h0, g.h1) + '%';
    g.b.style.width = (pct(g.fin, g.h0, g.h1) - pct(g.ini, g.h0, g.h1)) + '%';
    var e = g.b.querySelector('i');
    if (e) e.textContent = h2a(g.ini) + '–' + h2a(g.fin);
  });

  /* EL CLIC QUE VIENE DESPUÉS DEL GESTO.

     El navegador dispara un `click` al soltar aunque el puntero se haya movido
     media pantalla, así que al terminar de arrastrar se abría también la ficha
     «Quién lo cubre». Pedro lo vio al tiro: «se me abrió esta ventana también».

     Se traga ese clic —y solo ese— en fase de captura, para que no llegue al
     escuchador de la barra. Un clic de verdad, sin arrastre, sigue abriendo la
     ficha: es lo que distingue el umbral de 3 px. */
  caja.addEventListener('click', function (ev) {
    if (!tragarClic) return;
    tragarClic = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);

  function soltar() {
    if (!g) return;
    var x = g; g = null;
    if (x.activo) tragarClic = true;
    caja.querySelectorAll('.lpista.encima').forEach(function (p) { p.classList.remove('encima'); });
    x.b.classList.remove('llevando', 'estirando');
    x.b.style.pointerEvents = '';
    if (!x.activo) return;                 // fue un clic: lo atiende la ficha

    var movido = Math.abs(x.ini - x.iniOrig) >= 0.001 || Math.abs(x.fin - x.finOrig) >= 0.001;
    if (x.modo === 'mover') {
      var destino = x.fila ? (x.fila.dataset.fila || null) : undefined;
      // Soltar fuera de toda fila no es «dejarlo sin dueño»: es no haber
      // elegido. Se conserva el dueño y solo cambia la hora.
      if (destino === undefined) return movido ? soltarTurno(x.id, null, x.ini, true) : null;
      return soltarTurno(x.id, destino, x.ini, false);
    }
    if (movido) estirarTurno(x.id, x.ini, x.fin);
  }
  caja.addEventListener('pointerup', soltar);
  caja.addEventListener('pointercancel', soltar);
}


function estirarTurno(id, ini, fin) {
  var a = S.asignaciones.filter(function (x) { return x.id === id; })[0];
  if (!a) return;
  var copia = JSON.parse(JSON.stringify(a));
  var cambio = { hora_inicio: h2a(ini), hora_fin: h2a(fin) };
  DATOS.asignaciones.guardar(id, cambio).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', id, 'editar', copia,
                 Object.assign({}, copia, cambio));
    recordar('cambiar la hora del turno', function () {
      return DATOS.asignaciones.guardar(id, {
        hora_inicio: copia.hora_inicio, hora_fin: copia.hora_fin });
    });
    return recargarSemana();
  }).catch(function (e) { alert('No se pudo cambiar la hora: ' + e.message); });
}

function soltarTurno(id, filaId, horaNueva, soloHora) {
  var a = S.asignaciones.filter(function (x) { return x.id === id; })[0];
  if (!a) return;

  var dur = horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin));
  var antes = a2h(a.hora_inicio);
  var inicio = (horaNueva != null && Math.abs(horaNueva - antes) >= SALTO) ? horaNueva : antes;
  if (inicio < 0) inicio = 0;
  var mismaHora = Math.abs(inicio - antes) < 0.001;

  var cambio = {};
  if (soloHora) {
    // Se soltó fuera de las filas: no se eligió dueño, así que no se toca.
  } else if (S.agrupar === 'persona') {
    if ((a.trabajador_id || null) !== (filaId || null)) cambio.trabajador_id = filaId || null;
  } else if (filaId && a.cargo_id !== filaId) {
    cambio.cargo_id = filaId;
  }
  // Nada cambió: no se escribe ni se ensucia el Deshacer con un paso vacío.
  if (mismaHora && !Object.keys(cambio).length) return;

  if (!mismaHora) {
    cambio.hora_inicio = h2a(inicio);
    cambio.hora_fin    = h2a(inicio + dur);
  }

  /* Quitarle el turno a alguien se pregunta; correrlo de lado no.
     Es la regla que Pedro pidió en la malla y vale igual acá. */
  if ('trabajador_id' in cambio && a.trabajador_id) {
    var de = nombreTrab(a.trabajador_id);
    var para = filaId ? nombreTrab(filaId) : 'Sin asignar';
    if (!confirm('Este turno es de ' + de + '.\n\n¿Pasárselo a ' + para + '?')) return;
  }

  var copia = JSON.parse(JSON.stringify(a));
  DATOS.asignaciones.guardar(id, cambio).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', id, 'editar', copia,
                 Object.assign({}, copia, cambio));
    recordar('mover el turno', function () {
      return DATOS.asignaciones.guardar(id, {
        trabajador_id: copia.trabajador_id, cargo_id: copia.cargo_id,
        hora_inicio: copia.hora_inicio, hora_fin: copia.hora_fin });
    });
    return recargarSemana();
  }).catch(function (e) { alert('No se pudo mover: ' + e.message); });
}

/* El mes, con sus semanas numeradas a la izquierda. Las celdas van compactas:
   en un mes no cabe el detalle, y pretender que quepa lo deja ilegible. Se ve
   dónde falta gente y se entra al día para arreglarlo. */
function pintarMes() {
  var r = rangoVista(), hoy = hoyTexto(), f = r.desde, html = '';
  html += '<div class="mescab">' + ['lunes','martes','miérc.','jueves','viernes','sábado','domingo']
    .map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
  while (f <= r.hasta) {
    html += '<div class="mesfila"><span class="numsem" title="Semana del año">S'
          + semanaISO(f) + '</span><div class="messem">';
    for (var i = 0; i < 7; i++) { html += celdaDia(f, hoy, true); f = masDias(f, 1); }
    html += '</div></div>';
  }
  var m = $('#malla');
  m.className = 'malla mes';
  pintarPie();
  m.innerHTML = html;
  $('#cEstado').textContent = resumenPublicar();
}


function pintarNecesidad(n) {
  var mias = S.asignaciones.filter(function (a) { return a.necesidad_id === n.id; });
  var cubren = mias.filter(function (a) { return a.trabajador_id; }).length;
  var falta = n.personas_requeridas - cubren;
  var clase = falta === 0 ? 'cob-completo' : (falta > 0 ? 'cob-falta' : 'cob-sobra');
  var texto = falta === 0 ? 'Completo'
            : (falta > 0 ? 'Falta ' + falta : 'Sobra ' + (-falta));

  return '<div class="nec ' + colorCargo(n.cargo_id) + '">'
    + '<div class="cab" data-nec="' + n.id + '">'
      + '<span class="cargo">' + esc(nombreCargo(n.cargo_id)) + '</span>'
      + '<span class="horas">' + hhmm(n.hora_inicio) + '–' + hhmm(n.hora_fin) + '</span>'
      + '<span class="espacio"></span>'
      + '<span class="cobertura ' + clase + '">' + texto + '</span>'
    + '</div>'
    + '<ul class="gente">'
      + mias.map(pintarAsignacion).join('')
      + '<li><button class="mas" data-asig="' + n.id + '">+ quién lo cubre</button></li>'
    + '</ul></div>';
}

function pintarAsignacion(a) {
  var publicado = S.turnos.some(function (t) {
    return t.asignacion_id === a.id && t.estado === 'publicado';
  });
  var quien = a.trabajador_id ? esc(nombreTrab(a.trabajador_id)) : 'pendiente';
  return '<li class="' + (a.trabajador_id ? (publicado ? 'publicado' : 'borrador') : 'pendiente')
       + '" data-asigid="' + a.id + '">'
       + quien + '<span class="hs">' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</span></li>';
}

function pintarSuelta(a) {
  return '<div class="nec suelta ' + colorCargo(a.cargo_id) + '">'
    + '<div class="cab"><span class="cargo">' + esc(nombreCargo(a.cargo_id)) + '</span>'
    + '<span class="horas">' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</span>'
    + '<span class="espacio"></span><span class="cobertura cob-falta">sin planificar</span></div>'
    + '<ul class="gente">' + pintarAsignacion(a) + '</ul></div>';
}

/* EL BLOQUE DE LA SEMANA, como lo arma Skello (opción A1, elegida por Pedro
   el 09-10 tras ver las dos láminas).

   Horario arriba, la otra cara del turno abajo, y las HORAS en la esquina.
   Verificado en sus 29 capturas: «El bloque creado muestra horario arriba,
   puesto abajo y las horas en la esquina».

   La cara que va abajo depende de cómo esté agrupado, y es lo mismo que hacen
   ellos: si las filas son personas, cada bloque dice su PUESTO —el nombre ya
   está en la fila y repetirlo no informa—; si las filas son cargos, dice QUIÉN.

   Se descartó A2 (una barrita proporcional dentro del bloque) porque necesita
   un marco común contra el cual medir, y ese marco es la jornada del local, que
   todavía no existe: hoy la franja se deduce de los turnos que haya. Con un
   marco sacado del propio día, un día flojo se dibuja igual de lleno que uno
   cargado y la barrita miente. Queda anotado para cuando esa jornada exista. */
function pintarBloqueSemana(a, abajo) {
  var publicado = S.turnos.some(function (t) {
    return t.asignacion_id === a.id && t.estado === 'publicado';
  });
  var sinDueno = !a.trabajador_id;
  var pie = abajo === 'cargo' ? nombreCargo(a.cargo_id)
          : (sinDueno ? 'sin asignar' : nombreTrab(a.trabajador_id));
  return '<li class="blq ' + colorCargo(a.cargo_id)
       + (sinDueno ? ' pendiente' : (publicado ? ' publicado' : ' borrador'))
       + '" data-asigid="' + a.id + '">'
       + '<b>' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</b>'
       + '<span class="dur">' + numero(horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin))) + 'h</span>'
       + '<em>' + esc(pie) + '</em></li>';
}

/* LA MALLA GIRADA: filas de gente (o de cargos) y columnas de días.

   Esto es lo que Skello llama «Employés | Postes», y aquí sale casi gratis por
   una decisión del modelo: el cargo viaja EN EL TURNO, no en la persona. Si el
   cargo fuera una propiedad de la gente —como era en la malla antes del 03-10—
   esta vista no se podría dibujar sin inventar datos.

   Las dos agrupaciones comparten el mismo dibujo y solo cambian en dos cosas:
   de dónde salen las filas y cómo se decide qué asignación va en cada una. */
function pintarGirada() {
  var dias = [];
  if (S.vista === 'dia') dias = [S.dia];
  else for (var i = 0; i < 7; i++) dias.push(masDias(S.lunes, i));

  var filas, deQuien;
  if (S.agrupar === 'persona') {
    filas = S.trabajadores.map(function (p) { return { id: p.id, nombre: p.nombre }; });
    // Lo pendiente no se esconde: tiene su propia fila al final.
    filas.push({ id: null, nombre: 'Sin asignar', suelto: true });
    deQuien = function (a) { return a.trabajador_id; };
  } else {
    filas = S.cargos.map(function (q) { return { id: q.id, nombre: q.nombre }; });
    deQuien = function (a) { return a.cargo_id; };
  }

  var hoy = hoyTexto();
  var html = '<table class="girada"><thead><tr><th class="rot"></th>'
    + dias.map(function (f) {
        return '<th' + (f === hoy ? ' class="hoy"' : '') + '><b>' + nombreDia(f) + '</b>'
             + '<span>' + diaMes(f) + '</span></th>';
      }).join('') + '</tr></thead><tbody>';

  filas.forEach(function (fila) {
    html += '<tr' + (fila.suelto ? ' class="suelto"' : '') + '><th class="rot">'
          + esc(fila.nombre) + '</th>';
    dias.forEach(function (f) {
      var suyas = S.asignaciones.filter(function (a) {
        return a.fecha === f && deQuien(a) === fila.id;
      });
      // La cara que NO es la fila: filas de personas → el puesto; filas de
      // cargos → quién lo hace.
      var abajo = S.agrupar === 'persona' ? 'cargo' : 'persona';
      html += '<td' + (f === hoy ? ' class="hoy"' : '') + '>'
        + (suyas.length
            ? '<ul class="gente bloques">'
              + suyas.map(function (a) { return pintarBloqueSemana(a, abajo); }).join('')
              + '</ul>'
            : '<span class="nada">·</span>')
        + '</td>';
    });
    html += '</tr>';
  });

  var m = $('#malla');
  m.className = 'malla girada';
  m.innerHTML = html + '</tbody></table>';
  pintarPie();
  $('#cEstado').textContent = resumenPublicar();
}

// ---------- navegación ----------
// El paso del «anterior/siguiente» depende de la vista: un día, una semana o
// un mes. Si siempre moviera una semana, en la vista Mes no pasaría nada
// visible y parecería roto.
function mover(n) {
  if (S.vista === 'dia') { S.dia = masDias(S.dia, n); S.lunes = lunesDe(S.dia); }
  else if (S.vista === 'mes') {
    var p = S.lunes.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + n, 1);
    S.lunes = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), '01'].join('-');
  } else S.lunes = masDias(S.lunes, n * 7);
  pintarSelectores(); recargarSemana();
}
$('#btnAntes').addEventListener('click',    function () { mover(-1); });
$('#btnDespues').addEventListener('click',  function () { mover(1); });
$('#btnDeshacer').addEventListener('click', function () {
  var u = hist.pop(); if (!u) return;
  var b = this; b.disabled = true;
  pintarDeshacer();
  Promise.resolve().then(u.deshacer).then(function () {
    return recargarSemana();
  }).catch(function (e) {
    // Si no se pudo deshacer, se devuelve a la pila: perder la posibilidad de
    // intentarlo otra vez sería peor que el fallo.
    hist.push(u); pintarDeshacer();
    alert('No pude deshacer «' + u.texto + '»: ' + e.message);
  }).then(function () { pintarDeshacer(); });
});
$('#btnHoy').addEventListener('click',      function () {
  S.dia = hoyTexto(); S.lunes = lunesDe(S.dia); pintarSelectores(); recargarSemana();
});
/* Botones y no un desplegable, como Skello.

   Un desplegable esconde las opciones: hay que abrirlo para saber que existen,
   y hay que recordar en cuál se está. Con los botones a la vista se ve de un
   golpe dónde estás y qué más hay. Pedro eligió esta forma (msg 5193) después
   de comprobar contra sus capturas que Skello usa un cambio, no una lista. */
$('#cAgrupar').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  S.agrupar = b.dataset.g;
  // Agrupar por gente no tiene sentido en el Mes: se vuelve a Semana y se dice.
  if (S.agrupar !== 'dia' && S.vista === 'mes') {
    S.vista = 'semana';
    avisoPlan('La vista <b>Mes</b> no se puede agrupar por persona ni por cargo '
            + '—serían 31 columnas—, así que te dejé en <b>Semana</b>.');
  }
  pintarSelectores(); pintarMalla();
});
// El selector de cargo del gráfico se repinta con la malla, así que el oyente
// va en el contenedor y no en el elemento: enganchar el de adentro lo deja
// muerto en cuanto se vuelve a dibujar.
$('#malla').addEventListener('change', function (ev) {
  if (ev.target.id !== 'cCargoGraf') return;
  S.cargoGraf = ev.target.value;
  pintarMalla();
});
$('#cVista').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  S.vista = b.dataset.v;
  if (!S.dia) S.dia = hoyTexto();
  pintarSelectores(); recargarSemana();
});
/* Vuelve a ser lo que era: elegir local aquí es elegir QUÉ SE PLANIFICA, y
   nada más. Con las tarjetas, Configuración ya no depende de este selector —
   ese acoplamiento lo había metido yo y fue justo lo que confundió a Pedro. */
$('#cSucursal').addEventListener('change',  function () { S.sucursal = this.value; recargarSemana(); });

$('#nav').addEventListener('click', function (ev) {
  var b = ev.target.closest('.tab'); if (!b) return;
  $$('#nav .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t === b)); });
  ['plan','equipo','config','mio'].forEach(function (p) { $('#t-'+p).hidden = (p !== b.dataset.p); });
  if (b.dataset.p === 'mio') pintarMios();
});

// Un solo oyente para toda la malla: los botones se repintan constantemente y
// enganchar uno por uno es como se queda un botón muerto sin que nadie lo note.
$('#malla').addEventListener('click', function (ev) {
  var t = ev.target;
  if (t.dataset.nueva)  return abrirNecesidad(null, t.dataset.nueva);
  if (t.dataset.suelta) return abrirAsignacion(null, null, t.dataset.suelta);
  if (t.dataset.asig)   return abrirAsignacion(null, t.dataset.asig, null);
  var cab = t.closest('[data-nec]');
  if (cab) return abrirNecesidad(S.necesidades.filter(function (n) { return n.id === cab.dataset.nec; })[0]);
  var li = t.closest('[data-asigid]');
  if (li) {
    var a = S.asignaciones.filter(function (x) { return x.id === li.dataset.asigid; })[0];
    if (a) abrirAsignacion(a, a.necesidad_id, a.fecha);
  }
});

// ====================================================================
// NECESIDAD
// ====================================================================
var necActual = null;
function abrirNecesidad(n, fecha) {
  if (!S.cargos.length) return alert('Primero crea al menos un cargo en Equipo.');
  necActual = n || null;
  $('#nTit').textContent = n ? 'Qué hace falta' : 'Qué hace falta';
  $('#nCargo').innerHTML = S.cargos.map(function (q) {
    return '<option value="' + q.id + '">' + esc(q.nombre) + '</option>';
  }).join('');
  $('#nHorario').innerHTML = '<option value="">— escribir las horas —</option>'
    + atajosDe(S.sucursal).map(function (h) {
        return '<option value="' + h.id + '">' + esc(h.nombre) + ' · '
             + hhmm(h.hora_inicio) + '–' + hhmm(h.hora_fin) + '</option>';
      }).join('');
  $('#nFecha').value   = n ? n.fecha : (fecha || hoyTexto());
  $('#nCargo').value   = n ? n.cargo_id : S.cargos[0].id;
  $('#nEntra').value   = n ? hhmm(n.hora_inicio) : '09:00';
  $('#nSale').value    = n ? hhmm(n.hora_fin)    : '17:00';
  $('#nCuantos').value = n ? n.personas_requeridas : 1;
  $('#nBorrar').hidden = !n;
  aviso('#nMsg', '');
  pintarMedia();
  $('#dlgNec').showModal();
}

function pintarMedia() {
  $('#nMedia').hidden = !($('#nSale').value && $('#nEntra').value
                          && $('#nSale').value <= $('#nEntra').value);
}
$('#nEntra').addEventListener('change', pintarMedia);
$('#nSale').addEventListener('change', pintarMedia);

// Copiar de un horario guardado: trae las horas y nada más. El horario no es
// dueño de esta necesidad; si mañana lo borran, esto sigue igual.
$('#nHorario').addEventListener('change', function () {
  var h = S.horarios.filter(function (x) { return x.id === this.value; }.bind(this))[0];
  if (!h) return;
  $('#nEntra').value = hhmm(h.hora_inicio);
  $('#nSale').value  = hhmm(h.hora_fin);
  pintarMedia();
});

$('#nCancelar').addEventListener('click', function () { $('#dlgNec').close(); });
$('#nGuardar').addEventListener('click', function () {
  var d = {
    sucursal_id: S.sucursal, empresa_id: S.yo.empresa_id,
    fecha: $('#nFecha').value, cargo_id: $('#nCargo').value,
    hora_inicio: $('#nEntra').value, hora_fin: $('#nSale').value,
    personas_requeridas: Math.max(1, Number($('#nCuantos').value) || 1),
  };
  if (!d.fecha || !d.hora_inicio || !d.hora_fin) return aviso('#nMsg', 'Faltan el día y las horas.', 'bad');
  aviso('#nMsg', 'Guardando…');
  var p = necActual ? DATOS.necesidades.guardar(necActual.id, d) : DATOS.necesidades.crear(d);
  var antes = necActual && JSON.parse(JSON.stringify(necActual));
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', fila.id, necActual ? 'editar' : 'crear', necActual, fila);
    if (antes) recordar('el cambio en ' + nombreCargo(antes.cargo_id), function () {
      return DATOS.necesidades.guardar(antes.id, {
        fecha: antes.fecha, cargo_id: antes.cargo_id, hora_inicio: antes.hora_inicio,
        hora_fin: antes.hora_fin, personas_requeridas: antes.personas_requeridas });
    });
    else recordar('crear ' + nombreCargo(fila.cargo_id), function () {
      return DATOS.necesidades.borrar(fila.id);
    });
    $('#dlgNec').close(); return recargarSemana();
  }).catch(function (e) { aviso('#nMsg', e.message, 'bad'); });
});

$('#nBorrar').addEventListener('click', function () {
  if (!necActual) return;
  var cuantas = S.asignaciones.filter(function (a) { return a.necesidad_id === necActual.id; }).length;
  // Decir cuánta gente queda suelta ANTES de borrar. Lo que no se avisa se
  // descubre cuando ya pasó.
  var m = cuantas
    ? 'Esta necesidad tiene ' + cuantas + ' persona(s) asignada(s). Si la borras, '
      + 'esas asignaciones quedan como «sin planificar», no se borran. ¿Sigo?'
    : '¿Borrar lo que hace falta ese día?';
  if (!confirm(m)) return;
  var copia = JSON.parse(JSON.stringify(necActual));
  DATOS.necesidades.borrar(necActual.id).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', necActual.id, 'borrar', necActual, null);
    recordar('borrar ' + nombreCargo(copia.cargo_id), function () {
      return DATOS.necesidades.crear({
        empresa_id: copia.empresa_id, sucursal_id: copia.sucursal_id, fecha: copia.fecha,
        cargo_id: copia.cargo_id, hora_inicio: copia.hora_inicio, hora_fin: copia.hora_fin,
        personas_requeridas: copia.personas_requeridas });
    });
    $('#dlgNec').close(); return recargarSemana();
  }).catch(function (e) { aviso('#nMsg', e.message, 'bad'); });
});

// ====================================================================
// ASIGNACIÓN
// ====================================================================
var asigActual = null, asigNecesidad = null, asigFecha = null;
function abrirAsignacion(a, necesidadId, fecha) {
  asigActual = a || null;
  asigNecesidad = necesidadId || null;
  var n = necesidadId ? S.necesidades.filter(function (x) { return x.id === necesidadId; })[0] : null;
  asigFecha = fecha || (n ? n.fecha : hoyTexto());

  $('#aTit').textContent = a ? 'Quién lo cubre' : 'Quién lo cubre';
  $('#aDe').innerHTML = n
    ? esc(nombreCargo(n.cargo_id)) + ' · ' + hhmm(n.hora_inicio) + '–' + hhmm(n.hora_fin)
      + ' · ' + nombreDia(n.fecha) + ' ' + diaMes(n.fecha)
    : '<b>Turno suelto</b> — sin nada planificado detrás. Va a salir marcado como «sin planificar».';

  // Los cargos SUGIEREN: el que lo tiene marcado sale primero, pero están todos.
  var cargoId = n ? n.cargo_id : (S.cargos[0] || {}).id;
  var sabe = [], resto = [];
  S.trabajadores.forEach(function (p) {
    var tiene = (p.trabajador_cargos || []).some(function (x) { return x.cargo_id === cargoId; });
    (tiene ? sabe : resto).push(p);
  });
  $('#aQuien').innerHTML = '<option value="">— dejar pendiente —</option>'
    + (sabe.length ? '<optgroup label="Hacen este cargo">' + sabe.map(opcion).join('') + '</optgroup>' : '')
    + (resto.length ? '<optgroup label="Los demás">' + resto.map(opcion).join('') + '</optgroup>' : '');

  $('#aQuien').value = a && a.trabajador_id ? a.trabajador_id : '';
  $('#aEntra').value = a ? hhmm(a.hora_inicio) : (n ? hhmm(n.hora_inicio) : '09:00');
  $('#aSale').value  = a ? hhmm(a.hora_fin)    : (n ? hhmm(n.hora_fin)    : '17:00');
  $('#aBorrar').hidden = !a;
  aviso('#aMsg', '');
  pintarOjo();
  $('#dlgAsig').showModal();
}
function opcion(p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }

/* El aviso cuando la persona no tiene ese cargo. AVISA, NO BLOQUEA: Pedro fue
   explícito —«igual un cajero podría tomar el trabajo de un mesero»—. */
function pintarOjo() {
  var pid = $('#aQuien').value;
  var n = asigNecesidad ? S.necesidades.filter(function (x) { return x.id === asigNecesidad; })[0] : null;
  var cargoId = n ? n.cargo_id : null;
  var e = $('#aOjo');
  if (!pid || !cargoId) { e.hidden = true; return; }
  var p = S.trabajadores.filter(function (x) { return x.id === pid; })[0];
  var tiene = (p && (p.trabajador_cargos || []).some(function (x) { return x.cargo_id === cargoId; }));
  e.hidden = tiene;
  if (!tiene) e.innerHTML = '⚠️ <b>' + esc(p ? p.nombre : '') + '</b> no tiene marcado «'
    + esc(nombreCargo(cargoId)) + '». Puedes asignarlo igual.';
}
$('#aQuien').addEventListener('change', pintarOjo);

$('#aCancelar').addEventListener('click', function () { $('#dlgAsig').close(); });
$('#aGuardar').addEventListener('click', function () {
  var n = asigNecesidad ? S.necesidades.filter(function (x) { return x.id === asigNecesidad; })[0] : null;
  var d = {
    empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal,
    necesidad_id: asigNecesidad || null,
    trabajador_id: $('#aQuien').value || null,
    fecha: asigFecha,
    hora_inicio: $('#aEntra').value, hora_fin: $('#aSale').value,
    cargo_id: n ? n.cargo_id : (asigActual ? asigActual.cargo_id : (S.cargos[0] || {}).id),
    // Lo puso una persona: ningún generador automático lo va a pisar.
    origen: 'mano', tocado_a_mano: true, estado: 'confirmada',
  };
  if (!d.cargo_id) return aviso('#aMsg', 'Primero crea un cargo en Equipo.', 'bad');
  if (!d.hora_inicio || !d.hora_fin) return aviso('#aMsg', 'Faltan las horas.', 'bad');
  aviso('#aMsg', 'Guardando…');
  var p = asigActual ? DATOS.asignaciones.guardar(asigActual.id, d) : DATOS.asignaciones.crear(d);
  var antesA = asigActual && JSON.parse(JSON.stringify(asigActual));
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', fila.id, asigActual ? 'editar' : 'crear', asigActual, fila);
    if (antesA) recordar('el cambio en el turno', function () {
      return DATOS.asignaciones.guardar(antesA.id, {
        trabajador_id: antesA.trabajador_id, hora_inicio: antesA.hora_inicio,
        hora_fin: antesA.hora_fin, cargo_id: antesA.cargo_id });
    });
    else recordar('asignar a ' + (fila.trabajador_id ? nombreTrab(fila.trabajador_id) : 'pendiente'),
      function () { return DATOS.asignaciones.borrar(fila.id); });
    $('#dlgAsig').close(); return recargarSemana();
  }).catch(function (e) {
    // El índice único es el que impide duplicar el MISMO bloque. Traducirlo,
    // porque el texto de Postgres no le dice nada a nadie.
    if (/asignaciones_sin_repetir/.test(e.message))
      return aviso('#aMsg', 'Esa persona ya tiene un turno que empieza a esa hora ese día.', 'bad');
    aviso('#aMsg', e.message, 'bad');
  });
});

$('#aBorrar').addEventListener('click', function () {
  if (!asigActual) return;
  if (!confirm('¿Quitar esta asignación?')) return;
  DATOS.turnos.borrarDe([asigActual.id]).catch(function () {})
    .then(function () { return DATOS.asignaciones.borrar(asigActual.id); })
    .then(function () {
      DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', asigActual.id, 'borrar', asigActual, null);
      $('#dlgAsig').close(); return recargarSemana();
    }).catch(function (e) { aviso('#aMsg', e.message, 'bad'); });
});

// ====================================================================
// PUBLICAR
//
// Convierte en turnos lo que ya tiene persona. Lo que está pendiente no se
// publica: no hay a quién decírselo.
//
// NO DUPLICA, y no es un detalle: un botón que duplica al segundo clic es un
// botón que da miedo apretar, y entonces no se usa aunque funcione. Se mira
// qué turno existe ya para cada asignación y se crea solo la diferencia.
// ====================================================================
function paraPublicar() {
  return S.asignaciones.filter(function (a) {
    return a.trabajador_id && a.estado !== 'anulada';
  });
}
function resumenPublicar() {
  var listas = paraPublicar();
  var nuevas = listas.filter(function (a) {
    return !S.turnos.some(function (t) { return t.asignacion_id === a.id; });
  }).length;
  var cambiadas = listas.filter(function (a) {
    var t = S.turnos.filter(function (x) { return x.asignacion_id === a.id; })[0];
    return t && (hhmm(t.hora_inicio) !== hhmm(a.hora_inicio)
              || hhmm(t.hora_fin)    !== hhmm(a.hora_fin)
              || t.trabajador_id !== a.trabajador_id);
  }).length;
  if (!nuevas && !cambiadas) return 'Todo publicado';
  var p = [];
  if (nuevas)    p.push(nuevas + ' sin publicar');
  if (cambiadas) p.push(cambiadas + ' cambiada(s)');
  return p.join(' · ');
}

$('#btnPublicar').addEventListener('click', function () {
  var listas = paraPublicar();
  if (!listas.length) return alert('No hay nada con persona asignada que publicar.');
  var b = this; b.disabled = true;
  var ahora = new Date().toISOString();

  var nuevas = [], cambios = [];
  listas.forEach(function (a) {
    var t = S.turnos.filter(function (x) { return x.asignacion_id === a.id; })[0];
    var fila = {
      empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal, asignacion_id: a.id,
      trabajador_id: a.trabajador_id, fecha: a.fecha,
      hora_inicio: a.hora_inicio, hora_fin: a.hora_fin, cargo_id: a.cargo_id,
      estado: 'publicado', publicado_en: ahora,
    };
    if (!t) nuevas.push(fila);
    else if (hhmm(t.hora_inicio) !== hhmm(a.hora_inicio)
          || hhmm(t.hora_fin)    !== hhmm(a.hora_fin)
          || t.trabajador_id !== a.trabajador_id
          || t.estado !== 'publicado') cambios.push({ id: t.id, d: fila });
  });

  var paso = nuevas.length ? DATOS.turnos.crearLote(nuevas) : Promise.resolve([]);
  paso.then(function () {
    return Promise.all(cambios.map(function (c) { return DATOS.turnos.guardar(c.id, c.d); }));
  }).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'turno', null, 'publicar', null,
                 { nuevas: nuevas.length, cambiados: cambios.length, semana: S.lunes });
    return recargarSemana();
  }).then(function () {
    alert(nuevas.length + ' turno(s) publicado(s), ' + cambios.length + ' actualizado(s).');
  }).catch(function (e) { alert('No pude publicar: ' + e.message); })
    .then(function () { b.disabled = false; });
});

// ====================================================================
// EQUIPO Y CONFIGURACIÓN
//
// Un solo diálogo para los cuatro: trabajador, cargo, local y horario. Cuatro
// formularios casi iguales son cuatro sitios donde arreglar el mismo defecto.
// ====================================================================
var ficha = null;
// Desde que tarjeta se apreto «+ agregar tramo»: ese local queda elegido en el
// dialogo. Si se abriera siempre en «todos», el gesto diria una cosa y el
// formulario otra.
var tramoPara = null;
function abrirFicha(tipo, dato) {
  ficha = { tipo: tipo, dato: dato || null };
  var campos = '';
  if (tipo === 'trabajador') {
    $('#fTit').textContent = dato ? 'Trabajador' : 'Nuevo trabajador';
    campos = campo('text', 'fNombre', 'Nombre', dato ? dato.nombre : '')
           + campo('number', 'fValor', 'Valor hora (opcional)', dato ? (dato.valor_hora || '') : '')
           + '<label>Cargos que hace</label><div class="fld">' + marcas('fc', S.cargos,
               (dato && dato.trabajador_cargos || []).map(function (x) { return x.cargo_id; })) + '</div>'
           + '<p class="hint">Esto <b>sugiere</b> a quién ofrecerle un turno. Nunca impide nada.</p>'
           + '<label>En qué locales trabaja</label><div class="fld">' + marcas('fs', S.sucursales,
               (dato && dato.trabajador_sucursales || []).map(function (x) { return x.sucursal_id; })) + '</div>';
  } else if (tipo === 'cargo') {
    $('#fTit').textContent = dato ? 'Cargo' : 'Nuevo cargo';
    campos = campo('text', 'fNombre', 'Nombre', dato ? dato.nombre : '');
  } else if (tipo === 'sucursal') {
    $('#fTit').textContent = dato ? 'Local' : 'Nuevo local';
    campos = campo('text', 'fNombre', 'Nombre', dato ? dato.nombre : '')
           + campo('text', 'fZona', 'Zona horaria', dato ? dato.zona_horaria : 'America/Santiago')
           + '<p class="hint">El nombre de la zona, no la diferencia de horas: así el cambio de '
           + 'hora se arregla solo. Chile tiene dos — <code>America/Santiago</code> y '
           + '<code>America/Punta_Arenas</code>.</p>'
           /* El horario del local NO se edita aquí: vive en su propia sección
              «Establecimiento», como el Établissement de Skello (msg 5255).
              Tenerlo en los dos lados seria pedir que algún dia discrepen. */
           + '<p class="hint">El horario del local se edita en <b>Establecimiento</b>, '
           + 'arriba en esta misma pantalla.</p>';
  } else {
    $('#fTit').textContent = dato ? 'Tramo frecuente' : 'Nuevo tramo';
    campos = campo('text', 'fNombre', 'Nombre', dato ? dato.nombre : '')
           + '<div class="fldrow">'
           + campo('time', 'fEntra', 'Entra', dato ? hhmm(dato.hora_inicio) : '09:00')
           + campo('time', 'fSale', 'Sale', dato ? hhmm(dato.hora_fin) : '17:00')
           + '</div>'
           + (S.hayAtajoPorLocal === false
               ? '<p class="hint">⚠️ Todavía no se puede elegir el local: falta pegar '
                 + '<code>arreglo-horarios-por-local.sql</code>.</p>'
               : '<label for="fSucH">¿De qué local?</label>'
                 + '<select id="fSucH" class="fld">'
                 + S.sucursales.map(function (x) {
                     var elegido = (dato && dato.sucursal_id) || tramoPara;
                     var m = elegido === x.id ? ' selected' : '';
                     return '<option value="' + x.id + '"' + m + '>' + esc(x.nombre) + '</option>';
                   }).join('')
                 + '</select>'
                 + '<p class="hint">El tramo sale del horario del local, así que es de uno '
                 + 'solo. Si el mismo rango te sirve en otro, créalo también allá: quedan '
                 + 'separados y cambiar uno no toca al otro.</p>');
  }
  $('#fCampos').innerHTML = campos;
  aviso('#fMsg', '');
  $('#dlgFicha').showModal();
}
function campo(tipo, id, etiqueta, valor) {
  return '<div class="fld"><label for="' + id + '">' + esc(etiqueta) + '</label>'
       + '<input type="' + tipo + '" id="' + id + '" value="' + esc(valor) + '"></div>';
}
function marcas(pre, lista, marcados) {
  if (!lista.length) return '<p class="hint">Todavía no hay.</p>';
  return lista.map(function (x) {
    var m = marcados.indexOf(x.id) >= 0 ? ' checked' : '';
    return '<label style="font-weight:400;display:flex;gap:.4rem;align-items:center">'
         + '<input type="checkbox" style="width:auto" data-' + pre + '="' + x.id + '"' + m + '> '
         + esc(x.nombre) + '</label>';
  }).join('');
}

$('#fCancelar').addEventListener('click', function () { $('#dlgFicha').close(); });
$('#fGuardar').addEventListener('click', function () {
  var nombre = ($('#fNombre') || {}).value;
  if (!nombre || !nombre.trim()) return aviso('#fMsg', 'Ponle un nombre.', 'bad');
  nombre = nombre.trim();
  var emp = S.yo.empresa_id, t = ficha.tipo, d = ficha.dato;
  aviso('#fMsg', 'Guardando…');
  var p;

  if (t === 'cargo') {
    /* EL COLOR SE ELIGE AL CREAR, y no se deja en el valor por defecto.

       La columna `color` existe desde el primer día con `default 1`, y nadie la
       escribía nunca: todos los cargos reales de Pedro quedaron en 1, así que
       «el color sale del cargo» no distinguía NADA en su pantalla. En la demo
       se veía bien porque ahí los colores están puestos a mano — una prueba
       que pasa por un dato que la realidad no tiene.

       Se reparte el menos usado de los cuatro, para que dos cargos nuevos no
       salgan iguales mientras queden colores libres. */
    var usados = S.cargos.map(function (q) { return q.color || 1; });
    var libre = [1, 2, 3, 4].sort(function (x, y) {
      return usados.filter(function (u) { return u === x; }).length
           - usados.filter(function (u) { return u === y; }).length;
    })[0];
    p = d ? DATOS.cargos.guardar(d.id, { nombre: nombre })
          : DATOS.cargos.crear(emp, { nombre: nombre, color: libre });
  } else if (t === 'sucursal') {
    var s = { nombre: nombre, zona_horaria: ($('#fZona').value || 'America/Santiago').trim() };

    p = d ? DATOS.sucursales.guardar(d.id, s) : DATOS.sucursales.crear(emp, s);
  } else if (t === 'horario') {
    var h = { nombre: nombre, hora_inicio: $('#fEntra').value, hora_fin: $('#fSale').value };
    // Igual que siempre: sin la columna, no se manda.
    if (S.hayAtajoPorLocal) h.sucursal_id = ($('#fSucH') || {}).value || null;
    // Antes editar no hacia nada (`Promise.resolve`). Con el local como campo,
    // editar si tiene sentido: es como se corrige un tramo puesto en el local
    // equivocado.
    p = d ? DATOS.horarios.guardar(d.id, h) : DATOS.horarios.crear(emp, h);
  } else {
    var w = { nombre: nombre, valor_hora: Number($('#fValor').value) || null };
    p = (d ? DATOS.trabajadores.guardar(d.id, w) : DATOS.trabajadores.crear(emp, w))
      .then(function (fila) {
        var cs = $$('[data-fc]').filter(function (x) { return x.checked; }).map(function (x) { return x.dataset.fc; });
        var ss = $$('[data-fs]').filter(function (x) { return x.checked; }).map(function (x) { return x.dataset.fs; });
        return Promise.all([
          DATOS.trabajadores.ponerCargos(fila.id, cs),
          DATOS.trabajadores.ponerSucursales(fila.id, ss),
        ]).then(function () { return fila; });
      });
  }

  p.then(function (fila) {
    DATOS.anotar(emp, S.yo.id, t, fila && fila.id, d ? 'editar' : 'crear', d, fila);
    $('#dlgFicha').close(); return cargarTodo();
  }).catch(function (e) {
    if (/cargos_unicos/.test(e.message)) return aviso('#fMsg', 'Ya tienes un cargo con ese nombre.', 'bad');
    aviso('#fMsg', e.message, 'bad');
  });
});

$('#btnTrabajador').addEventListener('click', function () { abrirFicha('trabajador', null); });
$('#btnCargo').addEventListener('click',      function () { abrirFicha('cargo', null); });
$('#btnSucursal').addEventListener('click',   function () { abrirFicha('sucursal', null); });

function pintarEquipo() {
  $('#listaTrabajadores').innerHTML = S.trabajadores.length
    ? S.trabajadores.map(function (p) {
        var cs = (p.trabajador_cargos || []).map(function (x) { return nombreCargo(x.cargo_id); });
        return '<div class="item" data-tipo="trabajador" data-id="' + p.id + '"><b>' + esc(p.nombre) + '</b>'
             + '<span class="sub">' + (cs.length ? esc(cs.join(' · ')) : 'sin cargos') + '</span></div>';
      }).join('')
    : '<p class="vacio">Todavía no hay nadie. Agrega a tu gente.</p>';

  $('#listaCargos').innerHTML = S.cargos.length
    ? S.cargos.map(function (q) {
        return '<div class="item" data-tipo="cargo" data-id="' + q.id + '"><b>' + esc(q.nombre) + '</b></div>';
      }).join('')
    : '<p class="vacio">Sin cargos no se puede decir qué hace falta. Crea el primero.</p>';
}

/* Un tramo es de UN local. Punto.

   Lo tuve con un «sirve para todos los locales» y estaba de mas. Pedro lo
   desarmo con una pregunta (msg 5300): «por que dos locales, con horarios
   distintos, deben tener iguales tramos frecuentes?». No deben — el tramo sale
   del horario del local, asi que uno que abre de noche no comparte tramos con
   uno que abre de dia.

   Yo lo habia defendido con un argumento de migracion: no inventarle un local
   a los tramos que ya existieran. Al ir a comprobarlo, NO EXISTIA NINGUNO — su
   propia captura decia «Ninguno todavia». Estaba protegiendo datos que no
   habia, y a cambio metia un concepto que el no pidio. El argumento era bueno
   en abstracto y falso aqui, que para el resultado es lo mismo. */
function atajosDe(sucursalId) {
  return S.horarios.filter(function (h) { return h.sucursal_id === sucursalId; });
}

/* Un tramo sin local no sale en ninguna tarjeta. No se esconde: desaparecer en
   silencio es peor que verse fuera de sitio. Hoy no deberia haber ninguno. */
function atajosHuerfanos() {
  return S.horarios.filter(function (h) { return !h.sucursal_id; });
}

/* UNA TARJETA POR LOCAL  (opcion C, Pedro msg 5277)

   Lo que habia antes eran DOS controles para la misma idea: el desplegable de
   «Establecimiento» y la lista «Locales» con el elegido marcado. Pedro: «esto
   esta poco intuitivo». Tenia razon — tener que preguntarse cual de los dos
   usar ERA el defecto, y lo habia creado yo arreglando el anterior.

   Ahora no hay nada que elegir antes de escribir: cada local es una tarjeta
   con sus datos, y comparar dos es mirar. De paso se corta un acoplamiento
   feo que yo mismo habia metido: cambiar de local aqui ya no cambia lo que se
   esta planificando. */
function tarjetaLocal(loc) {
  var falta = S.hayHorarioLocal === false;
  var sinHora = !loc.abre || !loc.cierra;
  return '<div class="tarj-local" data-loc="' + loc.id + '">'
    + '<div class="cab"><b>' + esc(loc.nombre) + '</b>'
      + '<button class="plano" data-renombrar="' + loc.id + '">Renombrar</button>'
      + '<span class="espacio"></span>'
      + '<button class="primario chico" data-guardar-loc="' + loc.id + '"'
      + (falta ? ' disabled' : '') + '>Guardar</button></div>'
    + '<div class="fldrow">'
      + campo('text', 'z_' + loc.id, 'Zona horaria', loc.zona_horaria || 'America/Santiago')
      + campo('time', 'a_' + loc.id, 'Abre',   loc.abre   ? hhmm(loc.abre)   : '')
      + campo('time', 'c_' + loc.id, 'Cierra', loc.cierra ? hhmm(loc.cierra) : '')
    + '</div>'
    + (falta
        ? '<p class="hint">⚠️ El horario no se puede guardar todavía: falta pegar '
          + '<code>arreglo-horario-local.sql</code>.</p>'
        : (sinHora
            ? '<p class="hint"><span class="avisito">sin horario</span> '
              + 'La franja del día se deduce de los turnos.</p>'
            : ''))
    /* LOS TRAMOS, DENTRO DE SU LOCAL (opcion C), y de UN solo local.
       Ya no hay marca de «compartido»: no hay compartidos. */
    + '<div class="sep-tramos">Tramos frecuentes de este local</div>'
    + (atajosDe(loc.id).length
        ? '<div class="tramos">' + atajosDe(loc.id).map(function (h) {
            return '<div class="tramo" data-tramo="' + h.id + '">'
                 + '<b>' + esc(h.nombre) + '</b>'
                 + '<span class="sub">' + hhmm(h.hora_inicio) + '–' + hhmm(h.hora_fin) + '</span>'
                 + '<span class="espacio"></span>'
                 + '<button class="plano" data-abrirt="' + h.id + '">Editar</button>'
                 + '<button class="plano" data-borrart="' + h.id + '">Borrar</button></div>';
          }).join('') + '</div>'
        : '<p class="hint sin-tramos">Ninguno todavía. Son opcionales.</p>')
    + '<button class="agregar-tramo" data-nuevotramo="' + loc.id + '">+ agregar tramo</button>'
    + '</div>';   // ← faltaba: sin esto el navegador ANIDA una tarjeta dentro
                  //   de la anterior. Y no lo delata contar `.tarj-local`,
                  //   porque anidadas tambien cuentan: se vio MIRANDO.
}

document.addEventListener('click', function (ev) {
  var id = ev.target.dataset.guardarLoc;
  if (id) {
    var loc = S.sucursales.filter(function (x) { return x.id === id; })[0];
    if (!loc) return;
    var d = { zona_horaria: ($('#z_' + id).value || 'America/Santiago').trim() };
    // Igual que antes: sin las columnas no se mandan, o PostgREST rechaza el
    // POST entero y deja de poder guardarse el local.
    if (S.hayHorarioLocal) {
      d.abre   = $('#a_' + id).value || null;
      d.cierra = $('#c_' + id).value || null;
    }
    ev.target.disabled = true;
    return DATOS.sucursales.guardar(id, d).then(cargarTodo)
      .catch(function (e) { alert('No se pudo guardar: ' + e.message); });
  }
  var nt = ev.target.dataset.nuevotramo;
  if (nt) { tramoPara = nt; return abrirFicha('horario', null); }

  var bt = ev.target.dataset.borrart;
  if (bt) {
    if (!confirm('¿Borrar este tramo? No afecta a ningún turno: solo es un atajo.')) return;
    return DATOS.horarios.borrar(bt).then(cargarTodo);
  }

  var at = ev.target.dataset.abrirt;
  if (at) {
    var ha = S.horarios.filter(function (x) { return x.id === at; })[0];
    if (ha) { tramoPara = ha.sucursal_id || (S.sucursales[0] || {}).id || null;
              return abrirFicha('horario', ha); }
  }

  var r = ev.target.dataset.renombrar;
  if (r) {
    var l2 = S.sucursales.filter(function (x) { return x.id === r; })[0];
    if (l2) abrirFicha('sucursal', l2);
  }
});

function pintarConfig() {
  var sueltos = atajosHuerfanos();
  $('#listaSucursales').innerHTML = (S.sucursales.length
    ? S.sucursales.map(tarjetaLocal).join('')
    : '<p class="vacio">Crea tu primer local para poder planificar.</p>')
    + (sueltos.length
        ? '<div class="tarj-local"><div class="cab"><b>Tramos sin local</b></div>'
          + '<p class="hint">No aparecen al planificar en ningún local. Dales uno.</p>'
          + '<div class="tramos">'
          + sueltos.map(function (h) {
              return '<div class="tramo"><b>' + esc(h.nombre) + '</b>'
                   + '<span class="sub">' + hhmm(h.hora_inicio) + '–' + hhmm(h.hora_fin) + '</span>'
                   + '<span class="espacio"></span>'
                   + '<button class="plano" data-abrirt="' + h.id + '">Darle local</button>'
                   + '<button class="plano" data-borrart="' + h.id + '">Borrar</button></div>';
            }).join('')
          + '</div></div>'
        : '');
}

['#listaTrabajadores','#listaCargos'].forEach(function (sel) {
  $(sel).addEventListener('click', function (ev) {
    var it = ev.target.closest('.item'); if (!it) return;
    var listas = { trabajador:S.trabajadores, cargo:S.cargos };
    var dato = listas[it.dataset.tipo].filter(function (x) { return x.id === it.dataset.id; })[0];
    abrirFicha(it.dataset.tipo, dato);
  });
});

// ====================================================================
// MI CALENDARIO — lo que ve el trabajador. Solo lo publicado.
// ====================================================================
function pintarMios() {
  var caja = $('#listaMios');
  if (!S.yoTrabajador) {
    caja.innerHTML = '<p class="vacio">Tu cuenta todavía no está enlazada a un '
      + 'trabajador, así que no tienes turnos propios. Lo enlaza quien administra.</p>';
    return;
  }
  caja.innerHTML = '<p class="vacio">Cargando…</p>';
  DATOS.turnos.mios(S.yoTrabajador.id, S.lunes, masDias(S.lunes, 27)).then(function (ts) {
    caja.innerHTML = ts.length
      ? ts.map(function (t) {
          return '<div class="item"><b>' + nombreDia(t.fecha) + ' ' + diaMes(t.fecha) + '</b>'
               + '<span class="sub">' + hhmm(t.hora_inicio) + '–' + hhmm(t.hora_fin)
               + ' · ' + esc(nombreCargo(t.cargo_id)) + '</span></div>';
        }).join('')
      : '<p class="vacio">No tienes turnos publicados en las próximas semanas.</p>';
  }).catch(function (e) { caja.innerHTML = '<p class="vacio">' + esc(e.message) + '</p>'; });
}

/* Un asa para las pruebas, y se declara como lo que es.

   Sin esto, la prueba de humo tendria que llegar a todo por la pantalla, y hay
   cosas —abrir un dialogo concreto, mirar que quedo en memoria— que por ahi no
   se alcanzan. La alternativa era sacar todo a variables globales, que es peor:
   cualquiera las pisa sin querer.

   Expone SOLO lectura de estado y los tres abridores de dialogo. No hay nada
   aqui que la aplicacion no haga ya por si sola apretando botones. */
window.__app = {
  S: S,
  abrirNecesidad: abrirNecesidad,
  abrirAsignacion: abrirAsignacion,
  abrirFicha: abrirFicha,
  recargarSemana: recargarSemana,
};

/* Se arranca y ya. Si falta la configuracion, quien lo sabe es la capa de datos
   —es su asunto, no el de la pantalla— y lanza un error que `arrancar` muestra
   en el login como cualquier otro.

   Antes esto preguntaba por `window.CONFIG` aqui mismo, y el resultado fue que
   la DEMO —que no tiene configuracion porque no habla con Supabase— arrancaba
   mostrando «falta configurar» y no se podia probar nada. Una comprobacion
   puesta en la capa equivocada no solo estorba: tapa justo lo que se queria
   verificar. */
arrancar();
})();
