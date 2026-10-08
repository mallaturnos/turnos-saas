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
  sucursal:null, lunes:null, vista:'semana', dia:null, agrupar:'dia',
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
  if (S.agrupar !== 'dia' && S.vista !== 'mes') return pintarGirada();
  if (S.vista === 'dia') return pintarDia();
  if (S.vista === 'mes') return pintarMes();
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
  $('#cEstado').textContent = resumenPublicar();
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
  var hs = [], a2h = function (t) {
    var p = hhmm(t).split(':').map(Number); return p[0] + p[1] / 60;
  };
  delDia.concat(necsDia).forEach(function (x) {
    var i = a2h(x.hora_inicio), f = a2h(x.hora_fin);
    if (f <= i) f += 24;                     // cruza la medianoche
    hs.push(i, f);
  });
  /* EL DÍA COMPLETO, de 00:00 a 24:00, y cada turno en su hora.

     Pedro lo pidió así: «se debería tener visión del día completo y los turnos
     en los horarios que van». Tiene razón y es mejor que lo que yo había hecho.

     Yo ajustaba la franja a los turnos que ya existían, con algo de margen. El
     problema: la escala cambiaba cada día. Un martes con un turno de 09 a 17 y
     un miércoles con uno de 14 a 18 se dibujaban casi igual de anchos, así que
     comparar dos días engañaba, y no se veía que la noche entera está libre.

     Con el día entero siempre a la vista, una barra de ocho horas OCUPA un
     tercio del ancho y se nota: lo que falta por cubrir se ve sin pensar.

     Si un turno cruza la medianoche, la franja se estira hasta donde termine —
     ese turno existe y tiene que verse entero, no cortado en el borde. */
  var ini = 0;
  var fin = 24;
  hs.forEach(function (h) { if (h > fin) fin = Math.ceil(h); });
  var ancho = fin - ini;
  var pct = function (h) { return ((h - ini) / ancho) * 100; };

  // Las filas siguen lo que esté elegido arriba: gente, cargos o lo planificado.
  var filas;
  if (S.agrupar === 'persona') {
    filas = S.trabajadores.map(function (p) { return { nombre: p.nombre,
      suyas: delDia.filter(function (x) { return x.trabajador_id === p.id; }) }; });
  } else {
    filas = S.cargos.map(function (q) { return { nombre: q.nombre,
      suyas: delDia.filter(function (x) { return x.cargo_id === q.id; }),
      pide: necsDia.filter(function (n) { return n.cargo_id === q.id; }) }; });
  }
  filas = filas.filter(function (f) { return f.suyas.length || (f.pide && f.pide.length); });

  // Con el día entero, una marca por hora se amontona: se rotulan las pares y
  // las impares quedan como rayita, que es lo que hace cualquier regla.
  var horas = '';
  for (var h = ini; h <= fin; h++) {
    horas += '<span class="marca' + (h % 2 ? ' muda' : '') + '" style="left:' + pct(h) + '%">'
           + (h % 2 ? '' : String(h % 24).padStart(2, '0')) + '</span>';
  }

  var html = '<div class="linea"><div class="lcab"><span class="lrot"></span>'
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
      html += '<div class="lfila"><span class="lrot">' + esc(f.nombre) + '</span><div class="lpista">';
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
      var quien = x.trabajador_id ? nombreTrab(x.trabajador_id) : 'pendiente';
      // El nombre del grupo solo en la primera línea, si no hay fila de pedido.
      var rot = (!f.pide || !f.pide.length) && k === 0 ? esc(f.nombre) : '';
      html += '<div class="lfila"><span class="lrot chico">' + rot + '</span><div class="lpista">'
            + '<span class="lbarra' + (x.trabajador_id ? '' : ' sinnadie')
            + '" data-asigid="' + x.id + '"'
            + ' style="left:' + pct(i) + '%;width:' + (pct(ff) - pct(i)) + '%"'
            + ' title="' + esc(quien) + ' · ' + hhmm(x.hora_inicio) + '–' + hhmm(x.hora_fin) + '">'
            + '<b>' + esc(quien) + '</b> <i>' + hhmm(x.hora_inicio) + '–' + hhmm(x.hora_fin) + '</i>'
            + '</span></div></div>';
    });
  });

  html += '</div>' + celdaDia(S.dia, hoyTexto(), false);
  m.className = 'malla undia';
  m.innerHTML = html;
  $('#cEstado').textContent = resumenPublicar();
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
      html += '<td' + (f === hoy ? ' class="hoy"' : '') + '>'
        + (suyas.length
            ? '<ul class="gente">' + suyas.map(pintarAsignacion).join('') + '</ul>'
            : '<span class="nada">·</span>')
        + '</td>';
    });
    html += '</tr>';
  });

  var m = $('#malla');
  m.className = 'malla girada';
  m.innerHTML = html + '</tbody></table>';
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
$('#cVista').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  S.vista = b.dataset.v;
  if (!S.dia) S.dia = hoyTexto();
  pintarSelectores(); recargarSemana();
});
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
