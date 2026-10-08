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
var S = {
  sesion:null, yo:null, empresa:null,
  sucursales:[], cargos:[], trabajadores:[], horarios:[],
  sucursal:null, lunes:null,
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
function horasDe(entra, sale) {
  var a = entra.split(':').map(Number), b = sale.split(':').map(Number);
  var m = (b[0]*60 + b[1]) - (a[0]*60 + a[1]);
  if (m <= 0) m += 24*60;
  return m / 60;
}

var nombreCargo = function (id) {
  var q = S.cargos.filter(function (x) { return x.id === id; })[0];
  return q ? q.nombre : '—';
};
var nombreTrab = function (id) {
  var p = S.trabajadores.filter(function (x) { return x.id === id; })[0];
  return p ? p.nombre : '—';
};

function aviso(sel, texto, clase) {
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
  aviso('#eMsg', 'Conectando…');
  entrando = true;
  // Si en 15 segundos no pasó nada, decirlo. Un colgado callado se ve idéntico
  // a algo que está tardando, y la persona se queda mirando sin saber cuál es.
  clearTimeout(window.__tope);
  window.__tope = setTimeout(function () {
    if (/Entrando/.test($('#eMsg').textContent))
      aviso('#eMsg', 'Está tardando demasiado. Recarga con Ctrl+Shift+R y vuelve a intentar; '
                   + 'si sigue igual, avísame.', 'bad');
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
function paso(txt) { if (!$('#p-entrar').hidden) aviso('#eMsg', txt); }

function arrancar(sesionYaTengo) {
  paso('Verificando la sesión…');
  var paso0 = sesionYaTengo ? Promise.resolve(sesionYaTengo) : DATOS.auth.sesion();
  return paso0.then(function (ses) {
    paso('Buscando tu cuenta…');
    // Si llega tarde y ya hay alguien entrando, no toca la pantalla.
    if (!ses) { if (!entrando) mostrar('entrar'); return; }
    S.sesion = ses;
    return DATOS.yo().then(function (u) {
      if (!u) { mostrar('primera'); return; }
      S.yo = u;
      paso('Cargando tus datos…');
      return cargarTodo().then(function () { mostrar('app'); });
    });
  }).catch(function (e) {
    mostrar('entrar');
    aviso('#eMsg', e.message, 'bad');
  });
}

function cargarTodo() {
  return Promise.all([
    DATOS.sucursales.listar(), DATOS.cargos.listar(),
    DATOS.trabajadores.listar(), DATOS.horarios.listar(),
  ]).then(function (r) {
    S.sucursales = r[0]; S.cargos = r[1]; S.trabajadores = r[2]; S.horarios = r[3];
    S.yoTrabajador = S.trabajadores.filter(function (p) { return p.usuario_id === S.yo.id; })[0] || null;
    $('#hEmpresa').textContent = 'Turnos';
    $('#hQuien').textContent = S.yo.email;
    if (!S.sucursal) S.sucursal = (S.sucursales[0] || {}).id || null;
    if (!S.lunes) S.lunes = lunesDe(hoyTexto());
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
  $('#cSemana').textContent = diaMes(S.lunes) + ' — ' + diaMes(masDias(S.lunes, 6));
}

function recargarSemana() {
  if (!S.sucursal) {
    $('#malla').innerHTML = '';
    return avisoPlan('Todavía no tienes ningún local. Créalo en <b>Configuración</b>.');
  }
  if (!S.cargos.length)
    avisoPlan('Todavía no tienes cargos. Créalos en <b>Equipo</b>: sin cargos no se puede decir qué hace falta.');
  else avisoPlan(null);

  var desde = S.lunes, hasta = masDias(S.lunes, 6);
  return Promise.all([
    DATOS.necesidades.listar(S.sucursal, desde, hasta),
    DATOS.asignaciones.listar(S.sucursal, desde, hasta),
    DATOS.turnos.listar(S.sucursal, desde, hasta),
  ]).then(function (r) {
    S.necesidades = r[0]; S.asignaciones = r[1]; S.turnos = r[2];
    pintarMalla();
  }).catch(function (e) { avisoPlan('No pude cargar la semana: ' + esc(e.message)); });
}

function avisoPlan(html) {
  var e = $('#avisoPlan');
  e.hidden = !html; e.innerHTML = html || '';
}

// ====================================================================
// LA MALLA
// ====================================================================
function pintarMalla() {
  var hoy = hoyTexto();
  var html = '';
  for (var i = 0; i < 7; i++) {
    var f = masDias(S.lunes, i);
    var necs = S.necesidades.filter(function (n) { return n.fecha === f; });
    // Las que no cuelgan de ninguna necesidad: se asignó a alguien sin que
    // hubiera nada planificado. Van aparte y marcadas, no escondidas.
    var sueltas = S.asignaciones.filter(function (a) { return a.fecha === f && !a.necesidad_id; });

    html += '<div class="dia' + (f === hoy ? ' hoy' : '') + '">'
          + '<header><b>' + nombreDia(f) + '</b><span class="num">' + diaMes(f) + '</span></header>'
          + '<div class="cuerpo">';

    necs.forEach(function (n) { html += pintarNecesidad(n); });
    sueltas.forEach(function (a) { html += pintarSuelta(a); });

    html += '<button class="mas" data-nueva="' + f + '">+ qué hace falta</button>'
          + '<button class="mas" data-suelta="' + f + '">+ turno suelto</button>'
          + '</div></div>';
  }
  $('#malla').innerHTML = html;
  $('#cEstado').textContent = resumenPublicar();
}

function pintarNecesidad(n) {
  var mias = S.asignaciones.filter(function (a) { return a.necesidad_id === n.id; });
  var cubren = mias.filter(function (a) { return a.trabajador_id; }).length;
  var falta = n.personas_requeridas - cubren;
  var clase = falta === 0 ? 'cob-completo' : (falta > 0 ? 'cob-falta' : 'cob-sobra');
  var texto = falta === 0 ? 'Completo'
            : (falta > 0 ? 'Falta ' + falta : 'Sobra ' + (-falta));

  return '<div class="nec">'
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
  return '<div class="nec suelta">'
    + '<div class="cab"><span class="cargo">' + esc(nombreCargo(a.cargo_id)) + '</span>'
    + '<span class="horas">' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</span>'
    + '<span class="espacio"></span><span class="cobertura cob-falta">sin planificar</span></div>'
    + '<ul class="gente">' + pintarAsignacion(a) + '</ul></div>';
}

// ---------- navegación ----------
$('#btnAntes').addEventListener('click',    function () { S.lunes = masDias(S.lunes, -7); pintarSelectores(); recargarSemana(); });
$('#btnDespues').addEventListener('click',  function () { S.lunes = masDias(S.lunes,  7); pintarSelectores(); recargarSemana(); });
$('#btnHoy').addEventListener('click',      function () { S.lunes = lunesDe(hoyTexto()); pintarSelectores(); recargarSemana(); });
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
    + S.horarios.map(function (h) {
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
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', fila.id, necActual ? 'editar' : 'crear', necActual, fila);
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
  DATOS.necesidades.borrar(necActual.id).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', necActual.id, 'borrar', necActual, null);
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
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', fila.id, asigActual ? 'editar' : 'crear', asigActual, fila);
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
           + '<code>America/Punta_Arenas</code>.</p>';
  } else {
    $('#fTit').textContent = dato ? 'Horario' : 'Nuevo horario';
    campos = campo('text', 'fNombre', 'Nombre', dato ? dato.nombre : '')
           + '<div class="fldrow">'
           + campo('time', 'fEntra', 'Entra', dato ? hhmm(dato.hora_inicio) : '09:00')
           + campo('time', 'fSale', 'Sale', dato ? hhmm(dato.hora_fin) : '17:00')
           + '</div>';
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
    p = d ? DATOS.cargos.guardar(d.id, { nombre: nombre }) : DATOS.cargos.crear(emp, { nombre: nombre });
  } else if (t === 'sucursal') {
    var s = { nombre: nombre, zona_horaria: ($('#fZona').value || 'America/Santiago').trim() };
    p = d ? DATOS.sucursales.guardar(d.id, s) : DATOS.sucursales.crear(emp, s);
  } else if (t === 'horario') {
    var h = { nombre: nombre, hora_inicio: $('#fEntra').value, hora_fin: $('#fSale').value };
    p = d ? Promise.resolve(d) : DATOS.horarios.crear(emp, h);
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
$('#btnHorario').addEventListener('click',    function () { abrirFicha('horario', null); });

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

function pintarConfig() {
  $('#listaSucursales').innerHTML = S.sucursales.length
    ? S.sucursales.map(function (s) {
        return '<div class="item" data-tipo="sucursal" data-id="' + s.id + '"><b>' + esc(s.nombre) + '</b>'
             + '<span class="sub">' + esc(s.zona_horaria) + '</span></div>';
      }).join('')
    : '<p class="vacio">Crea tu primer local para poder planificar.</p>';

  $('#listaHorarios').innerHTML = S.horarios.length
    ? S.horarios.map(function (h) {
        return '<div class="item" data-tipo="horario" data-id="' + h.id + '"><b>' + esc(h.nombre) + '</b>'
             + '<span class="sub">' + hhmm(h.hora_inicio) + '–' + hhmm(h.hora_fin) + '</span>'
             + '<span class="espacio"></span><button class="plano" data-borrarh="' + h.id + '">Borrar</button></div>';
      }).join('')
    : '<p class="vacio">Ninguno todavía. Son opcionales.</p>';
}

['#listaTrabajadores','#listaCargos','#listaSucursales','#listaHorarios'].forEach(function (sel) {
  $(sel).addEventListener('click', function (ev) {
    var bh = ev.target.dataset.borrarh;
    if (bh) {
      ev.stopPropagation();
      if (!confirm('¿Borrar este horario? No afecta a ningún turno: solo es un atajo.')) return;
      return DATOS.horarios.borrar(bh).then(cargarTodo);
    }
    var it = ev.target.closest('.item'); if (!it) return;
    var listas = { trabajador:S.trabajadores, cargo:S.cargos, sucursal:S.sucursales, horario:S.horarios };
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
