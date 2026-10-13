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
  // Ausencias de la vista y el catalogo de tipos. `hayAusencias` en null
  // significa «todavia no pregunte»: con la migracion sin pegar queda false y
  // la pantalla sigue funcionando sin ellas.
  ausencias:[], tiposAusencia:[], bloqueos:[], hayAusencias:null,
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

/* CUÁNTO DURA, en H:MM.

   Pedro (msg 5361): «en todas las partes cuando aparece una hora de inicio y
   otra de fin, debería existir un contador de horas». Tiene razón y la clave
   está en «en todas las partes»: había TRECE sitios que pintan un par de
   horas, y arreglarlos de a uno garantiza que mañana alguien agregue el
   catorceavo sin contador.

   Por eso el par de horas se arma SIEMPRE con estas funciones y no a mano.
   Es el mismo criterio que la lista de paneles: no dejar nada que haya que
   acordarse de mantener. */
function durTexto(ini, fin) {
  var h = horasDe(hhmm(ini), hhmm(fin));
  var hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return hh + ':' + String(mm).padStart(2, '0');
}
// Para atributos (title=) y <option>: sin etiquetas, que ahí no se pintan.
function rangoTxt(ini, fin) {
  return hhmm(ini) + '–' + hhmm(fin) + ' · ' + durTexto(ini, fin);
}
// Para la pantalla: la duración en su propia etiqueta, más apagada.
function rangoHtml(ini, fin) {
  return hhmm(ini) + '–' + hhmm(fin) + ' <span class="dur">' + durTexto(ini, fin) + '</span>';
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
/* LOS QUE TODAVIA TRABAJAN AQUI.

   `S.trabajadores` los tiene a TODOS, porque hace falta para poner el nombre
   en los turnos de quien ya se fue. Pero a la hora de OFRECER gente —las filas
   de la malla, el desplegable de la ficha, el de ausencias— solo van los
   activos: si no, archivar no serviria de nada. */
function activos() {
  return S.trabajadores.filter(function (p) { return p.activo !== false; });
}

/* Quienes van como FILA: los que trabajan aqui, mas los que ya se fueron PERO
   tienen turnos en lo que se esta mirando.

   Sin la segunda mitad, archivar a alguien le haria desaparecer los turnos de
   la pantalla —no de la base, pero da igual: si no se ven, no estan—. Y con
   todos los idos siempre, la malla se llenaria de filas vacias de gente que ya
   no esta, que es justo lo que archivar venia a evitar. */
function conHistoria(asignaciones) {
  var hay = {};
  asignaciones.forEach(function (a) { if (a.trabajador_id) hay[a.trabajador_id] = true; });
  return S.trabajadores.filter(function (p) {
    return p.activo !== false || hay[p.id];
  });
}

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
  // El tope de los 15 segundos lo arma `paso()` para todos los pasos, también
  // los del arranque automático. Antes estaba aquí y solo cubría este camino.
  paso('Conectando…', generacion);
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

/* CUANDO LA SESION SE VENCE, LA PANTALLA LO DICE Y LLEVA A ENTRAR.

   Antes el aviso era «JWT expired», en rojo y en ingles, dentro del dialogo —
   y la persona se quedaba ahi apretando Guardar contra una sesion muerta. Lo
   vio Pedro el 11-10 con la pantalla abierta un rato largo.

   Se avisa UNA sola vez: si cada llamada que falla mandara a la pantalla de
   entrar, una malla con diez peticiones en vuelo parpadearia diez veces. */
var yaAvise = false;
DATOS.auth.alCambiar = function (e) {
  if (yaAvise) return;
  yaAvise = true;
  // Los dialogos abiertos se cierran: dejar uno encima del login es dejar a la
  // persona escribiendo en un formulario que ya no puede guardar nada.
  $$('dialog[open]').forEach(function (d) { try { d.close(); } catch (x) {} });
  mostrar('entrar');
  aviso('#eMsg', (e && e.message) || 'Tu sesión se venció. Entra de nuevo.', 'bad');
};

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
/* EL TOPE VIVE AQUI, Y NO EN EL BOTON ENTRAR.

   Estaba armado solo dentro de `entrarDeVerdad()`, o sea solo cuando la persona
   APRETABA Entrar. El arranque automatico de la pagina no tenia ninguno — y es
   justo el que colgo el 12-10: Pedro mando una foto con «Verificando la
   sesion... (251 s)» y la pantalla no le dijo nada en cuatro minutos. La guarda
   existia y no cubria su camino.

   Puesto en `paso()` cubre los dos, porque todo paso anunciado pasa por aqui, y
   cada paso nuevo reinicia su propio plazo. */
var CFG_TOPE = { ms: 15000 };

function paso(txt, mia) {
  if (mia !== undefined && mia !== generacion) return;
  if ($('#p-entrar').hidden) return;
  textoPaso = txt; desde = Date.now();
  clearInterval(reloj);
  clearTimeout(window.__tope);
  window.__tope = setTimeout(function () {
    // Solo si seguimos en ESE paso: si ya avanzo o fallo, el aviso seria falso.
    if (textoPaso !== txt) return;
    aviso('#eMsg', 'Está tardando demasiado en «' + txt.replace('…', '')
                 + '». Mándame esta pantalla.', 'bad');
  }, CFG_TOPE.ms);
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
    cargarPlantillas();
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

/* En la vista Día, «por día» no existe como agrupación: se trata como por
   cargo, que es lo que de hecho dibujaba.

   Vive en su propia función porque hace falta ANTES de pintar los botones y
   ANTES de pintar la malla. La primera versión la tenía solo dentro de
   `pintarMalla`, que corre DESPUÉS: el botón quedaba oculto pero marcado como
   elegido, y ninguno de los dos visibles aparecía seleccionado. */
function agrupacionValida() {
  if (S.vista === 'dia' && S.agrupar === 'dia') S.agrupar = 'cargo';
}

function pintarSelectores() {
  agrupacionValida();
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
  /* «Por día» NO se ofrece en la vista Día. Pedro: «en la vista día, por día
     es igual a por cargo... ¿cuál es la diferencia?». Ninguna, y ese era el
     problema: «por día» quiere decir «las filas son días», y en un solo día
     eso no significa nada — caía en el mismo dibujo que Cargos.

     Un botón que existe y no hace nada es peor que uno que falta: obliga a
     apretarlo para descubrir que da igual. */
  var soloUnDia = S.vista === 'dia';
  $$('#cAgrupar button').forEach(function (b) {
    var porDia = b.dataset.g === 'dia';
    b.hidden = porDia && soloUnDia;
    b.setAttribute('aria-selected', String(b.dataset.g === S.agrupar));
  });

  /* EL BOTÓN «HOY» SE ENCIENDE CUANDO NO ESTÁS MIRANDO HOY.

     Pedro lo pidió el 13-10 (msg 6175) preguntando si hacía falta un botón para
     volver al día actual. Ya existía: lo que faltaba era que DIJERA ALGO. Esa
     misma mañana se había perdido en la semana del 26/10 sin que nada en la
     pantalla se lo advirtiera — el botón se veía igual estando en hoy que a dos
     meses de distancia.

     Así que no lleva de vuelta solamente: avisa. Es el mismo patrón del botón
     «Today» de First Due, que cambia de color cuando te sales de la semana.

     Se pregunta por `rangoVista()`, que es lo que la pantalla está mostrando de
     verdad, y no por `S.lunes`: en la vista Mes el rango incluye los días de
     relleno, así que si hoy se ve en pantalla el botón NO se enciende. Lo que
     importa es si hoy está a la vista, no en qué variable cayó. */
  var r = rangoVista(), h = hoyTexto();
  $('#btnHoy').classList.toggle('lejos', h < r.desde || h > r.hasta);
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
  /* Las ausencias viajan con la semana, no aparte.

     Si se pidieran en otro momento, habria un instante —corto, pero real— en
     que la malla ya esta pintada y todavia no sabe quien no esta. Y una malla
     que por medio segundo dice que alguien viene es exactamente lo que las
     ausencias vienen a arreglar.

     `hay()` nunca falla: si la migracion no esta pegada devuelve false y la
     semana se carga igual, sin ausencias. */
  return DATOS.ausencias.hay().then(function (hay) {
    S.hayAusencias = hay;
    return Promise.all([
      DATOS.necesidades.listar(S.sucursal, desde, hasta),
      DATOS.asignaciones.listar(S.sucursal, desde, hasta),
      DATOS.turnos.listar(S.sucursal, desde, hasta),
      hay ? DATOS.ausencias.listar(desde, hasta) : Promise.resolve([]),
      hay ? DATOS.ausencias.tipos() : Promise.resolve([]),
      hay ? DATOS.ausencias.bloqueos() : Promise.resolve([]),
    ]);
  }).then(function (r) {
    S.necesidades = r[0]; S.asignaciones = r[1]; S.turnos = r[2];
    S.ausencias = r[3]; S.tiposAusencia = r[4]; S.bloqueos = r[5];
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
/* ---------- choques de turnos de una misma persona ----------

   Lo pidio Pedro viendo a Ana con 14:00-22:00 y 09:00-17:00 el mismo lunes
   (msg 5549), y hay que separar DOS cosas que parecen una:

     · SE PISAN  -> imposible. Nadie esta en dos sitios a la misma hora, y eso
       NO es un criterio del encargado: es aritmetica. Por eso aca si se
       bloquea, y no contradice el principio de «avisa, no bloquea» — ese
       principio protege sus CRITERIOS, no las imposibilidades.
     · PEGADOS O SEPARADOS el mismo dia -> legitimo. El turno partido existe y
       el esquema lo defiende a proposito. Se avisa y se deja guardar.

   LAS HORAS SE COMPARAN EN TIEMPO REAL, NO EN LA CARA DEL RELOJ. Un turno de
   22:00 a 06:00 termina AL DIA SIGUIENTE: mirando solo «22:00» y «06:00»
   pareceria que no choca con uno de 05:00 a 09:00 del dia siguiente, y choca.
   Por eso todo se pasa a minutos absolutos contados desde una fecha. */
function diaNum(fecha) {
  var p = fecha.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000;
}
function tramoAbs(a) {
  var ini = diaNum(a.fecha) * 1440 + a2h(hhmm(a.hora_inicio)) * 60;
  return { ini: ini, fin: ini + horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin)) * 60 };
}
/* Cuanto se pisan dos turnos, en minutos. 0 = no se pisan.
   Pegados NO se pisan: terminar a las 16:00 y entrar a las 16:00 es legitimo. */
function minutosQueSePisan(a, b) {
  var x = tramoAbs(a), y = tramoAbs(b);
  return Math.max(0, Math.min(x.fin, y.fin) - Math.max(x.ini, y.ini));
}
function minTexto(m) {
  var h = Math.floor(m / 60), mm = Math.round(m % 60);
  return (h ? h + ' h ' : '') + (mm ? mm + ' min' : (h ? '' : '0 min'));
}

/* ---------- ausencias: lo que la malla necesita saber ----------

   EL CHOQUE SE MIDE POR DIA DE CALENDARIO, NO POR HORAS. Es la decision que
   sale de mirar otros productos y la que Pedro aprobo: si alguien tiene el dia
   libre y se le pone un turno, se avisa AUNQUE LAS HORAS NO SE PISEN. Pilla
   mas casos y, sobre todo, se puede explicar en una frase. Comparar horas
   dejaria pasar el turno de la tarde sobre una licencia de la mañana, que es
   justo el caso que molesta.

   Una ausencia cubre un RANGO, asi que la comparacion es de texto entre
   'AAAA-MM-DD': ordenan igual que las fechas y no hay que fabricar objetos
   Date, que es donde aparecen los dias corridos en uno. */
function tipoAusencia(id) {
  for (var i = 0; i < S.tiposAusencia.length; i++)
    if (S.tiposAusencia[i].id === id) return S.tiposAusencia[i];
  return null;
}
function nombreTipoAusencia(id) {
  var t = tipoAusencia(id);
  return t ? t.nombre : 'Ausencia';
}
/* La unidad EFECTIVA de una ausencia: la que eligio, si eligio, y si no la de
   su tipo. Vive en una sola funcion porque se pregunta desde cuatro sitios —la
   banda, la marca del turno, el dialogo y el desglose— y cuatro copias de la
   misma regla es como se cuela que una quede vieja. */
function unidadDe(a) {
  if (a && a.unidad) return a.unidad;
  var t = a && tipoAusencia(a.tipo_id);
  return t ? t.unidad : 'dia';
}

function ausenciasDe(trabajadorId, fecha) {
  if (!trabajadorId) return [];
  return S.ausencias.filter(function (a) {
    return a.trabajador_id === trabajadorId && a.desde <= fecha && a.hasta >= fecha;
  });
}
function ausenciasDelDia(fecha) {
  return S.ausencias.filter(function (a) { return a.desde <= fecha && a.hasta >= fecha; });
}

function pintarMalla() {
  agrupacionValida();
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
  /* Las casillas marcadas solo existen en la tabla de la semana. Al salir de
     ahí se sueltan, y tiene que ser aquí y no en cada pintor: si quedaran
     marcadas, un Ctrl+V desde la vista Día —donde no se ve ni una casilla—
     escribiría turnos en una semana que la persona no está mirando. */
  var tabla = S.vista === 'semana' && S.agrupar !== 'dia';
  if (!tabla && SEL.claves.length) limpiarSeleccion();

  if (S.vista === 'dia') pintarDia();
  else if (S.vista === 'mes') pintarMes();
  else if (S.agrupar !== 'dia') pintarGirada();
  else pintarSemana();

  // La barra de abajo se decide DESPUÉS de saber qué se pintó, y en un solo
  // sitio: es la que enseña que existe copiar y pegar, y tiene que aparecer
  // también cuando no hay nada marcado todavía.
  avisarSeleccion();
}

/* La celda de un día es la MISMA en las tres vistas. Si se escribiera tres
   veces, cada arreglo habría que hacerlo tres veces y una se olvidaría — que es
   exactamente como se cuelan los defectos de «la mitad de los sitios». */
function celdaDia(f, hoy, compacta) {
  var necs = S.necesidades.filter(function (n) { return n.fecha === f; });
  /* Y LOS SUELTOS TAMBIÉN ORDENADOS. Las necesidades de abajo se ordenan desde
     hace semanas y estos no, y son los que más se ven: un turno pegado sale
     «sin planificar», así que lo que Pedro pegó el 12-10 caía justo aquí. El
     Mes y el Día se dibujan con esta misma función, de modo que el desorden que
     vio en la semana también llegaba allá. */
  var sueltas = S.asignaciones.filter(function (a) { return a.fecha === f && !a.necesidad_id; })
                              .sort(porHoraTurno);

  /* AGRUPADAS POR CARGO, y dentro del cargo por hora.

     Salían en el orden en que volvían de la base, así que crear otra «Caja»
     la mandaba al final de la tarjeta, lejos de la Caja que ya estaba.
     Pedro: «cuando creo otra caja, ¿no debería salir arriba en caja? ¿por qué
     la tiras abajo?».

     OJO, esto NO contradice lo de la línea de tiempo, donde el orden es por
     identidad: allá se arrastran las barras y recalcular el orden las movería
     bajo el dedo. Aquí no se arrastra nada — es una lista — así que el orden
     sí puede significar algo, y lo que significa es «lo del mismo cargo, junto». */
  necs.sort(function (x, y) {
    var cx = nombreCargo(x.cargo_id) || '', cy = nombreCargo(y.cargo_id) || '';
    if (cx !== cy) return cx.localeCompare(cy, 'es');
    return a2h(x.hora_inicio) - a2h(y.hora_inicio);
  });
  var html = '<div class="dia' + (f === hoy ? ' hoy' : '') + (compacta ? ' chico' : '') + '">'
    + '<header><b>' + (compacta ? f.split('-')[2] : nombreDia(f)) + '</b>'
    + '<span class="num">' + (compacta ? '' : diaMes(f)) + '</span></header>'
    + '<div class="cuerpo">'
    /* QUIEN NO ESTA, ARRIBA DE TODO y antes que los turnos.

       Abajo no sirve: se reparte gente mirando la parte de arriba de la
       tarjeta, y un aviso que hay que ir a buscar llega tarde. Es el mismo
       criterio del aviso dentro del dialogo — avisar MIENTRAS decides. */
    + bandaAusencias(f);
  necs.forEach(function (n) { html += pintarNecesidad(n); });
  sueltas.forEach(function (a) { html += pintarSuelta(a); });
  html += '<button class="mas" data-nueva="' + f + '">+ qué hace falta</button>';
  if (!compacta) html += '<button class="mas" data-suelta="' + f + '">+ turno suelto</button>';
  if (!compacta && S.hayAusencias)
    html += '<button class="mas" data-ausencia="' + f + '">+ ausencia / permiso</button>';
  return html + '</div></div>';
}


/* La banda de ausencias del dia. Vacia si no hay: una franja que dice «nadie
   falta» ocupa sitio todos los dias para no decir nada. */
function bandaAusencias(f) {
  var hoy = ausenciasDelDia(f);
  if (!hoy.length) return '';
  return '<div class="ausdia">' + hoy.map(function (a) {
    var u = unidadDe(a);
    var medio = u !== 'dia';
    return '<span class="aus' + (medio ? ' parcial' : '') + '" data-ausid="' + a.id + '" title="'
      + esc(nombreTipoAusencia(a.tipo_id)) + (a.nota ? ' — ' + esc(a.nota) : '') + '">'
      + esc(nombreTrab(a.trabajador_id) || 'alguien') + ' · '
      + esc(nombreTipoAusencia(a.tipo_id))
      + (medio ? ' (' + esc(u === 'medio_dia' ? 'medio día' : 'horas') + ')' : '')
      + '</span>';
  }).join('') + '</div>';
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
/* Los siete días con sus horas, calculados UNA SOLA VEZ.

   El pie se dibuja en dos sitios —la banda suelta y la fila de la tabla
   girada— y si cada uno sumara por su cuenta, el día que cambie la regla de
   qué cuenta como hora trabajada uno de los dos se queda con la vieja y nadie
   lo nota, porque los dos siguen mostrando números creíbles. */
function horasSemana() {
  var dias = [], total = 0;
  for (var i = 0; i < 7; i++) {
    var f = masDias(S.lunes, i), h = horasDeDia(f);
    total += h;
    dias.push({ fecha: f, horas: h });
  }
  return { dias: dias, total: total };
}

/* `yaVaDentro` lo pasa la vista girada, que dibuja sus horas DENTRO de la
   tabla. Sin esto se verían las dos y una contradiría a la otra en el ancho. */
function pintarPie(yaVaDentro) {
  var pie = $('#pieHoras');
  if (!pie) return;
  if (S.vista !== 'semana' || yaVaDentro) { pie.hidden = true; return; }
  var r = horasSemana(), celdas = '';
  r.dias.forEach(function (d) {
    celdas += '<span' + (d.horas ? '' : ' class="cero"') + '><b>'
            + nombreDia(d.fecha).slice(0, 3) + '</b>'
            + (d.horas ? numero(d.horas) + ' h' : '—') + '</span>';
  });
  pie.hidden = false;
  pie.innerHTML = '<span class="prot">Horas repartidas</span>' + celdas
                + '<span class="ptot"><b>Semana</b>' + numero(r.total) + ' h</span>';
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
    filas = conHistoria(delDia).map(function (p) { return { id: p.id, nombre: p.nombre,
      suyas: delDia.filter(function (x) { return x.trabajador_id === p.id; }),
      ido: p.activo === false }; });
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

  /* LA FRANJA DE COBERTURA — CUÁNTA GENTE HAY, HORA POR HORA, DE TODOS LOS CARGOS

     Reemplaza al gráfico de un solo cargo con su selector. Pedro lo encontró el
     13-10 a las 10:54: la pantalla le mostraba «Caja» plana en cero mientras lo
     único que había ese día era Cocina. No estaba rota — es que el selector
     caía en el primer cargo del catálogo, que justo no tenía nada.

     EL DEFECTO DE FONDO ERA PEDIR QUE ELIGIERA. Una vista de día contesta
     «¿cómo voy hoy?», y para eso hay que mirar el día entero, no un cargo. Así
     lo hace 7shifts: el número de gente por hora arriba del todo para todos, y
     el desglose por cargo sólo si lo pides —ahí, al pasar el cursor—.

     EL ÁMBAR MARCA LA HORA CON HUECO, y es el punto: una cifra dice cuántos
     faltan, el color dice CUÁNDO. Es lo que una banda por tramo no podía dar,
     porque si alguien se va a las 13:00 el hueco cambia de tamaño a esa hora.

     Lo puesto NO se escribe: se cuenta de los turnos. Lo único que se teclea es
     la necesidad; si se escribieran los dos, el día que no coincidan habría que
     decidir cuál miente. */
  var html = '';
  var enHora = function (x, h) {
    var i = a2h(x.hora_inicio), f = a2h(x.hora_fin); if (f <= i) f += 24;
    return i <= h && h < f;
  };
  var conPersona = delDia.filter(function (x) { return x.trabajador_id; });
  var franja = '', hayAlgo = false;
  for (var h = ini; h < fin; h++) {
    var puestos = 0, falta = 0, detalle = [];
    S.cargos.forEach(function (q) {
      var pide = necsDia.filter(function (n) {
        return n.cargo_id === q.id && enHora(n, h);
      }).reduce(function (t, n) { return t + (n.personas_requeridas || 0); }, 0);
      var hay = conPersona.filter(function (x) {
        return x.cargo_id === q.id && enHora(x, h);
      }).length;
      puestos += hay;
      if (pide > hay) falta += pide - hay;
      if (pide || hay) detalle.push(q.nombre + ': ' + hay + (pide > hay ? ' de ' + pide : ''));
    });
    if (puestos || falta) hayAlgo = true;
    franja += '<i' + (falta ? ' class="mal"' : '')
            + ' title="' + esc(String(h % 24).padStart(2, '0') + ':00 · '
                + (detalle.length ? detalle.join(' · ') : 'nadie')
                + (falta ? ' · falta ' + falta : '')) + '">'
            + puestos + '</i>';
  }
  if (hayAlgo) {
    html += '<div class="linea cobcaja">'
      + '<div class="cobtit"><span class="lrot"></span>'
      + '<b>Cuánta gente hay, hora por hora</b>'
      + '<span class="cobley"><i class="mal"></i> hora con algún hueco</span></div>'
      + '<div class="cobfila"><span class="lrot"></span>'
      + '<div class="cobtira">' + franja + '</div></div>'
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
    /* Primero lo PEDIDO, de fondo: el trozo sin cubrir queda a la vista.

       UNA LÍNEA POR NECESIDAD, no todas en la misma. Un cargo puede pedir dos
       tramos distintos el mismo día —«hacen falta 2 de 09 a 17» y «hacen falta
       3 de 12 a 20»— y si se dibujan en la misma línea **se encaraman**: no se
       ve dónde termina una y empieza la otra, y desde que se pueden arrastrar
       tampoco se puede agarrar la de abajo. Pedro: «está mal... sale
       sobrepuesto o no?».

       Es exactamente el mismo defecto que ya se había arreglado para los
       turnos y que a las necesidades no se les aplicó. El rótulo del grupo va
       solo en la primera línea, como allá. */
    /* SE DIBUJA LO QUE FALTA, NO LO QUE SE PIDIO (opción D, 12-10).

       Antes aquí iba una barra pálida por necesidad: «pide 2 de 08:00 a 16:00».
       Pedro preguntó qué le estaba diciendo esa barra, y la respuesta honesta
       era «casi nada»: cuando la gente cubre el tramo completo, la pálida mide
       exactamente lo mismo que la de abajo y repite la información.

       Al buscar qué hacen los demás resultó que **ninguno dibuja la necesidad**:
       Deputy y 7shifts dibujan turnos, y lo que falta es un turno sin nadie.
       Y al explicar él su propio flujo —«digo qué necesito, lo puedo crear con
       alguien o sin nadie, la persona la asigno después»— quedó claro que en su
       modelo **una necesidad sin cubrir YA ES ese turno sin dueño**. No son dos
       cosas: es la misma antes y después de ponerle nombre.

       Así que esto no copia a nadie: dibuja su necesidad como él la piensa. */
    var lineasHueco = 0;
    if (f.pide && f.pide.length) {
      f.pide.forEach(function (n) {
        var huecos = huecosDeNecesidad(n);
        if (!huecos.length) return;          // cubierta entera: no se dibuja nada
        var bloques = huecos.map(function (h) {
          /* `data-asig` lleva a «quién lo cubre» con la necesidad puesta: el
             hueco es apretable y hace lo único que uno quiere hacer con un
             hueco, que es taparlo. La barra pálida no hacía ni eso. */
          return '<span class="lhueco" data-asig="' + n.id + '"'
               + ' style="left:' + pct(h.desde) + '%;width:' + (pct(h.hasta) - pct(h.desde)) + '%"'
               + ' title="' + esc('Sin asignar · ' + nombreCargo(n.cargo_id) + ' · '
                   + rangoTxt(h2a(h.desde), h2a(h.hasta))
                   + (h.falta > 1 ? ' · faltan ' + h.falta + ' personas' : ' · falta 1 persona')
                   + ' · aprieta para cubrirlo') + '">'
               + '<b>sin asignar</b>' + (h.falta > 1 ? ' <i>×' + h.falta + '</i>' : '')
               + '</span>';
        }).join('');
        html += '<div class="lfila" data-fila="' + (f.id || '') + '">'
              + '<span class="lrot">' + (lineasHueco === 0 ? esc(f.nombre) : '') + '</span>'
              + '<div class="lpista">' + bloques + '</div></div>';
        lineasHueco++;
      });
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
      /* El nombre del grupo solo en la primera línea. Y depende de si se dibujó
         alguna línea de huecos, no de si HAY necesidades: desde la opción D una
         necesidad cubierta entera no dibuja nada, así que preguntar por
         `f.pide` dejaba la fila sin nombre justo cuando todo estaba cubierto. */
      var rot = lineasHueco === 0 && k === 0 ? esc(f.nombre) : '';
      html += '<div class="lfila" data-fila="' + (f.id || '') + '">'
            + '<span class="lrot chico">' + rot + '</span><div class="lpista">'
            + '<span class="lbarra ' + colorCargo(x.cargo_id) + (x.trabajador_id ? '' : ' sinnadie')
            + '" data-asigid="' + x.id + '"'
            + ' style="left:' + pct(i) + '%;width:' + (pct(ff) - pct(i)) + '%"'
            + ' title="' + esc(quien) + ' · ' + esc(nombreCargo(x.cargo_id)) + ' · '
            + rangoTxt(x.hora_inicio, x.hora_fin) + '">'
            + '<b>' + esc(rotulo) + '</b> <i>' + rangoHtml(x.hora_inicio, x.hora_fin) + '</i>'
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
    var b = ev.target.closest && ev.target.closest('.lbarra[data-asigid], .lpide[data-necid]');
    if (!b) return;
    var pista = b.closest('.lpista'), linea = pista && pista.closest('.linea');
    if (!pista || !linea) return;
    // Una necesidad y un turno se arrastran igual; solo cambia dónde se guarda
    // y que la necesidad NO cambia de fila (pertenece a su cargo).
    var esNec = !!b.dataset.necid;
    var a = esNec
      ? S.necesidades.filter(function (x) { return x.id === b.dataset.necid; })[0]
      : S.asignaciones.filter(function (x) { return x.id === b.dataset.asigid; })[0];
    if (!a) return;
    var i = a2h(a.hora_inicio), f = a2h(a.hora_fin); if (f <= i) f += 24;
    var tir = ev.target.closest('.tirador');
    g = {
      b: b, pista: pista, id: a.id, esNec: esNec, activo: false,
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

    /* La necesidad no cambia de fila: es de su cargo y ahí se queda. Solo se
       le corren las horas, se mueva donde se mueva el cursor. */
    if (x.esNec) { if (movido) moverNecesidad(x.id, x.ini, x.fin); return; }

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


function moverNecesidad(id, ini, fin) {
  var n = S.necesidades.filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  var copia = JSON.parse(JSON.stringify(n));
  var cambio = { hora_inicio: h2a(ini), hora_fin: h2a(fin) };
  DATOS.necesidades.guardar(id, cambio).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', id, 'editar', copia,
                 Object.assign({}, copia, cambio));
    recordar('cambiar las horas de lo que hace falta', function () {
      return DATOS.necesidades.guardar(id, {
        hora_inicio: copia.hora_inicio, hora_fin: copia.hora_fin });
    });
    return recargarSemana();
  }).catch(function (e) { alert('No se pudo mover: ' + e.message); });
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
/* ===================== EL MES POR PERSONA (forma B) =====================

   Pedro eligió B el 12-10 (msg 5909: «probemos con B») sobre la propuesta de
   `propuesta_mes.py`. Es la forma de Skello, que es además la que él ya había
   visto en una foto: UNA FILA POR PERSONA, el mes partido en semanas seguidas, y
   entre semana y semana una columna con el total de esa semana.

   POR QUE ASI Y NO 31 COLUMNAS SUELTAS. El argumento que yo mismo había dado
   para no hacer el mes —«serían 31 columnas»— era flojo, y los tres
   competidores lo resuelven: Skello partiendo en semanas, Deputy comprimiendo
   la celda. Partir en semanas además hace que el total semanal tenga dónde ir.

   QUE PREGUNTA CONTESTA, que es distinto de la semana. La semana contesta
   «¿quién cubre el martes?». El mes contesta «¿dónde hay huecos?» y «¿a quién le
   estoy cargando siempre lo mismo?» — y eso solo se ve con la fila de la persona
   entera delante.

   DE LECTURA, Y EL CLIC LLEVA A LA SEMANA. Nadie trabaja en lote en el mes:
   7shifts lo tiene de solo lectura y ni Deputy ni Connecteam dejan copiar ahí
   (Skello sí edita turnos sueltos; verificado y corregido el 12-10). Aquí el mes
   no intenta ser una rejilla de edición — pero tampoco te expulsa, que es lo que
   hacía antes: el clic en una casilla te LLEVA a esa semana, que es a donde
   ibas.

   LO QUE NO PUEDE MOSTRAR TODAVIA es la diferencia contra el contrato, porque
   las horas contratadas no existen (propuesta D de Equipo). El total de la
   semana sí, desde el primer día; la diferencia queda para cuando haya contra
   qué comparar. Se le dijo antes de empezar. */
function pintarMesB() {
  var r = rangoVista(), hoy = hoyTexto();

  // Las semanas del mes, cada una con sus siete días.
  var semanas = [], f = r.desde;
  while (f <= r.hasta) {
    var sem = [];
    for (var i = 0; i < 7; i++) { sem.push(f); f = masDias(f, 1); }
    semanas.push(sem);
  }
  var mes = S.lunes.slice(0, 7);   // el mes que manda, para apagar los vecinos
  var todos = semanas.reduce(function (t, x) { return t.concat(x); }, []);

  var filas, deQuien;
  if (S.agrupar === 'persona') {
    filas = conHistoria(S.asignaciones.filter(function (a) {
      return todos.indexOf(a.fecha) >= 0;
    })).map(function (p) {
      return { id: p.id, nombre: p.nombre, ido: p.activo === false };
    });
    filas.push({ id: null, nombre: 'Sin asignar', suelto: true });
    deQuien = function (a) { return a.trabajador_id; };
  } else {
    filas = S.cargos.map(function (q) { return { id: q.id, nombre: q.nombre }; });
    deQuien = function (a) { return a.cargo_id; };
  }

  var html = '<table class="mesb"><thead><tr><th class="rot"></th>';
  semanas.forEach(function (sem) {
    sem.forEach(function (d) {
      html += '<th class="d' + (d === hoy ? ' hoy' : '')
            + (d.slice(0, 7) !== mes ? ' vecino' : '') + '"'
            + ' title="' + nombreDia(d) + ' ' + diaMes(d) + '">'
            + d.slice(8) + '</th>';
    });
    html += '<th class="cont irsem" data-semana="' + sem[0] + '"'
          + ' title="Horas de la semana ' + semanaISO(sem[0])
          + ' · aprieta para ir a esa semana">'
          + 'S' + semanaISO(sem[0]) + '<i>h</i></th>';
  });
  html += '<th class="tot">Mes</th></tr></thead><tbody>';

  var porSemana = semanas.map(function () { return 0; });
  var totalMes = 0;

  filas.forEach(function (fila) {
    html += '<tr><th class="rot">' + esc(fila.nombre)
          + (fila.ido ? ' <span class="yano">ya no trabaja aquí</span>' : '') + '</th>';
    var mesHoras = 0;
    semanas.forEach(function (sem, iSem) {
      var semHoras = 0;
      sem.forEach(function (d) {
        var suyas = S.asignaciones.filter(function (a) {
          return a.fecha === d && deQuien(a) === fila.id;
        }).sort(porHoraTurno);
        suyas.forEach(function (a) {
          if (a.trabajador_id) semHoras += horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin));
        });
        /* `data-semana` es lo que convierte el mes en una puerta: el clic lleva
           a ESA semana en vez de dejarte donde estabas. */
        html += '<td class="d' + (d === hoy ? ' hoy' : '')
              + (d.slice(0, 7) !== mes ? ' vecino' : '') + '"'
              + ' data-dia="' + d + '"'
              + ' data-fila="' + esc(String(fila.id || '')) + '"'
              + ' title="' + esc(fila.nombre + ' · ' + nombreDia(d) + ' ' + diaMes(d)
                  + (suyas.length ? '' : ' · aprieta para agregarle un turno')) + '">'
              + suyas.map(function (a) {
                  /* `data-asigid` es todo lo que hace falta para que el clic
                     abra la ficha: el oyente de la malla ya abre cualquier cosa
                     que lleve ese atributo. Lo eligió Pedro (msg 5919, opción
                     C) y es lo que hace Skello, que edita en su vista Mes. */
                  return '<span class="mini ' + colorCargo(a.cargo_id) + '"'
                       + ' data-asigid="' + a.id + '"'
                       + ' title="' + esc(hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin)
                           + ' · ' + nombreCargo(a.cargo_id) + ' · aprieta para abrirlo') + '">'
                       + hhmm(a.hora_inicio).slice(0, 2) + '</span>';
                }).join('')
              + '</td>';
      });
      // Raya y no cero: un 0 se lee como «ahí no hay nada que ver».
      html += '<td class="cont">'
            + (semHoras ? numero(semHoras) + ' h' : '<span class="cero">—</span>')
            + '</td>';
      porSemana[iSem] += semHoras;
      mesHoras += semHoras;
    });
    html += '<td class="tot">'
          + (mesHoras ? '<b>' + numero(mesHoras) + ' h</b>' : '<span class="cero">—</span>')
          + '</td></tr>';
    totalMes += mesHoras;
  });

  html += '</tbody><tfoot><tr><th class="rot">Horas</th>';
  semanas.forEach(function (sem, iSem) {
    html += '<td class="d" colspan="7"></td>';
    html += '<td class="cont">'
          + (porSemana[iSem] ? numero(porSemana[iSem]) + ' h' : '<span class="cero">—</span>')
          + '</td>';
  });
  html += '<td class="tot">'
        + (totalMes ? '<b>' + numero(totalMes) + ' h</b>' : '<span class="cero">—</span>')
        + '</td></tr></tfoot></table>';

  var m = $('#malla');
  m.className = 'malla mesb-wrap';
  m.innerHTML = html;
  pintarPie();
  $('#cEstado').textContent = resumenPublicar();
  avisoPlan('En el <b>Mes</b> se ve dónde hay huecos y a quién le toca siempre lo mismo.'
          + ' <b>Aprieta un turno</b> para abrirlo, o una <b>casilla vacía</b> para'
          + ' agregarle uno — sin salir de aquí. El <b>número de semana</b> te lleva'
          + ' a esa semana.');
}

function pintarMes() {
  // Agrupado por persona o por cargo, el mes es la forma B. Por día sigue
  // siendo el calendario, que para mirar un mes suelto también sirve.
  if (esPlanilla()) return pintarMesB();
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


/* LA COBERTURA SE CUENTA EN UN SOLO SITIO.

   Lo encontró Pedro el 12-10 (msg 5910) en la vista Día: asignó gente, la
   tarjeta de abajo decía **Completo** y la barra de arriba seguía diciendo
   **«hacen falta 1»**. Preguntó si eso estaba bien. No lo estaba: eran dos
   frases sobre lo mismo diciendo lo contrario en la misma pantalla.

   La causa: la barra escribía `personas_requeridas` con las palabras «hacen
   falta», o sea el REQUISITO contado como si fuera el HUECO. Mientras no había
   nadie asignado las dos cosas coinciden, y por eso pasó inadvertido.

   Y había algo peor de fondo: la tarjeta calculaba la cobertura por su cuenta y
   la barra no la calculaba en absoluto. Ahora las dos preguntan aquí. Es la
   misma regla que `porHoraTurno`: si el orden —o la cuenta— se decide en dos
   sitios, algún día dicen cosas distintas, y entonces hay que elegir cuál
   miente. */
function estadoNecesidad(n) {
  var cubren = S.asignaciones.filter(function (a) {
    return a.necesidad_id === n.id && a.trabajador_id;
  }).length;
  var falta = n.personas_requeridas - cubren;
  return {
    cubren: cubren, falta: falta,
    clase: falta === 0 ? 'cob-completo' : (falta > 0 ? 'cob-falta' : 'cob-sobra'),
    texto: falta === 0 ? 'Completo'
         : (falta > 0 ? 'Falta ' + falta : 'Sobra ' + (-falta)),
  };
}

/* LOS HUECOS DE UNA NECESIDAD, TRAMO POR TRAMO.

   Pedro eligió D el 12-10 (msg 5929) después de preguntar qué le decía la barra
   pálida y de ver que **ninguna de las otras plataformas dibuja «la necesidad»**:
   Deputy y 7shifts dibujan turnos, y lo que falta es un turno sin nadie —Deputy
   lo llama *open / empty shift* y hasta tiene una fila propia para ellos—.

   Así que en la vista Día ya no se dibuja lo pedido: se dibuja **lo que falta**.

   Y se calcula de verdad, no a bulto. En cada instante del tramo pedido faltan
   `personas_requeridas` menos los que lo cubren EN ESE instante. Por eso se
   parte el tramo en los puntos donde alguien entra o sale, y cada pedazo lleva
   su propio déficit. Sin eso, una necesidad de 17:00 a 23:00 con alguien que se
   va a las 20:00 diría «falta 1» en todo el tramo —incluida la parte que sí
   está cubierta—, que es la clase de cifra que se deja de mirar.

   Los pedazos contiguos con el mismo déficit se juntan: tres bloques seguidos
   que dicen lo mismo son ruido. */
function huecosDeNecesidad(n) {
  var i = a2h(n.hora_inicio), ff = a2h(n.hora_fin); if (ff <= i) ff += 24;
  /* CUENTAN TODAS LAS ASIGNACIONES, CON NOMBRE O SIN NOMBRE.

     Esto se vio mirando la pantalla, no el código. Un turno «pendiente» —de los
     que Pedro crea sin nadie para asignar después— **ya es el hueco dibujado**:
     sale como barra rayada en la línea de turnos. Contando solo a los que
     tienen nombre, el mismo puesto que falta aparecía DOS VECES: la barra
     rayada y encima un bloque ámbar. Justo la duplicación que la opción D vino
     a quitar, reapareciendo con otra forma.

     Ojo con la diferencia, que es a propósito: la TARJETA sigue diciendo
     «Falta 1» cuando hay un pendiente, porque cuenta **personas** y ahí no hay
     nadie — eso lo decidió Pedro y tiene su propia comprobación desde hace
     días. Esta función cuenta **bloques ya dibujados**. Las dos son ciertas
     porque no contestan la misma pregunta.

     La invariante que deja: lo que se ve en la línea —turnos más huecos— suma
     siempre las personas que pediste. */
  var mias = S.asignaciones.filter(function (a) {
    return a.necesidad_id === n.id;
  }).map(function (a) {
    var x = a2h(a.hora_inicio), y = a2h(a.hora_fin); if (y <= x) y += 24;
    return { x: x, y: y };
  });

  var cortes = [i, ff];
  mias.forEach(function (m) {
    if (m.x > i && m.x < ff) cortes.push(m.x);
    if (m.y > i && m.y < ff) cortes.push(m.y);
  });
  cortes = cortes.filter(function (v, k, t) { return t.indexOf(v) === k; })
                 .sort(function (a, b) { return a - b; });

  var tramos = [];
  for (var k = 0; k < cortes.length - 1; k++) {
    var a0 = cortes[k], a1 = cortes[k + 1];
    if (a1 <= a0) continue;
    var cubren = mias.filter(function (m) { return m.x <= a0 && m.y >= a1; }).length;
    var falta = n.personas_requeridas - cubren;
    if (falta <= 0) continue;
    var ult = tramos[tramos.length - 1];
    if (ult && ult.hasta === a0 && ult.falta === falta) ult.hasta = a1;   // se juntan
    else tramos.push({ desde: a0, hasta: a1, falta: falta });
  }
  return tramos;
}

function pintarNecesidad(n) {
  var mias = S.asignaciones.filter(function (a) { return a.necesidad_id === n.id; })
                          .sort(porHoraTurno);
  var e = estadoNecesidad(n);
  var cubren = e.cubren, falta = e.falta, clase = e.clase, texto = e.texto;

  return '<div class="nec ' + colorCargo(n.cargo_id) + '">'
    + '<div class="cab" data-nec="' + n.id + '">'
      + '<span class="cargo">' + esc(nombreCargo(n.cargo_id)) + '</span>'
      + '<span class="horas">' + rangoHtml(n.hora_inicio, n.hora_fin) + '</span>'
      + '<span class="espacio"></span>'
      + '<span class="cobertura ' + clase + '">' + texto + '</span>'
      /* La × va FUERA de la cabecera apretable, como su propio botón: si
         estuviera dentro, apretarla abriría también la ficha. */
      + '<button class="borrar-nec" data-borrarnec="' + n.id + '"'
      + ' title="Borrar lo que hace falta">×</button>'
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

  /* EL TURNO QUE CHOCA CON UNA AUSENCIA SE MARCA EN LA MALLA.

     Sin esto, el aviso solo aparecia al asignar — y el caso corriente es el
     contrario: el turno ya estaba y la licencia llega despues. Se veia en la
     pantalla de la demo, no en el codigo: la banda decia «Benja · Licencia
     medica» y justo debajo seguia su turno de 12 a 16 como si nada.

     Es una marca, no un impedimento: el turno sigue ahi, se puede abrir y se
     puede dejar igual. Lo que no puede es pasar desapercibido. */
  /* EL TURNO QUE SE PISA CON OTRO DE LA MISMA PERSONA, marcado en la semana.

     Lo pregunto Pedro (msg 5612) y tenia razon en lo que no dije: el control
     que puse al guardar impide crear turnos nuevos que se pisen, pero LOS QUE
     YA ESTABAN siguen ahi, invisibles. Es exactamente el mismo agujero que las
     ausencias tuvieron esta tarde — avisar al asignar no alcanza, porque el
     caso corriente es que el problema ya este guardado.

     Se mira solo dentro de lo cargado en pantalla. Para avisar al GUARDAR se
     pregunta a la base, que es mas caro y mas exacto; para pintar la semana
     alcanza con lo que ya se trajo, y asi la malla no hace una consulta por
     cada turno que dibuja. */
  var pisa = a.trabajador_id && S.asignaciones.some(function (o) {
    return o.id !== a.id && o.trabajador_id === a.trabajador_id
        && minutosQueSePisan(a, o) > 0;
  });

  var choca = a.trabajador_id && ausenciasDe(a.trabajador_id, a.fecha).length > 0;
  var ausTxt = choca
    ? ausenciasDe(a.trabajador_id, a.fecha).map(function (x) {
        return nombreTipoAusencia(x.tipo_id); }).join(', ')
    : '';
  /* «No está» SOLO si la ausencia es de dia completo.

     El medio dia de examenes del art. 66 bis y las horas de un atraso dejan a
     la persona trabajando el resto de la jornada: decir «no está» ahi es
     falso, y el encargado podria salir a buscar reemplazo para un turno que si
     se va a cubrir. Se vio en la pantalla, no leyendo el codigo: la demo decia
     «Caro · no está» cuando Caro solo tenia medio dia de examenes. */
  var entero = choca && ausenciasDe(a.trabajador_id, a.fecha).some(function (x) {
    return unidadDe(x) === 'dia';
  });
  // El `title` lleva las dos cosas: qué estado tiene y, si choca, por qué.
  // Pisarlo con una sola dejaría la otra sin explicación.
  var partes = [estadoTexto(a, publicado)];
  if (choca) partes.push(quien + ' tiene ' + ausTxt + ' ese día');
  var titulo = ' title="' + esc(partes.join(' · ')) + '"';
  var marca  = choca ? '<span class="choque' + (entero ? '' : ' parte') + '">'
                     + (entero ? 'no está' : 'parte del día') + '</span>' : '';
  // «Se cruzan», no «se pisan»: lo pidio Pedro (msg 5622) y es la palabra que
  // se usa en un local.
  var marcaPisa = pisa ? '<span class="choque pisa">se cruza</span>' : '';
  return '<li class="' + (a.trabajador_id ? (publicado ? 'publicado' : 'borrador') : 'pendiente')
       + (choca ? ' choca' : '') + (pisa ? ' sepisa' : '')
       + '" data-asigid="' + a.id + '"' + titulo + '>'
       + quien + marcaPisa + marca
       + '<span class="hs">' + rangoHtml(a.hora_inicio, a.hora_fin) + '</span>'
       + botonQuitar(a) + '</li>';
}

/* La × de quitar, pedida por Pedro el 11-10 (msg 5630): «falta un pequeño
   botón quitar para no tener que ingresar…».

   Va en todas las caras del turno —el renglón de la vista por día y el bloque
   de la semana— porque el gesto tiene que ser el mismo en las dos: una función
   que existe en una pantalla y no en la otra se siente rota, no incompleta.

   Es un `<button>` de verdad y no un `<span>`: lo alcanza el tabulador y el
   lector de pantalla lo anuncia como lo que es. */
/* QUE SIGNIFICA EL PUNTITO, EN PALABRAS. Un solo sitio.

   El punto existia desde hace semanas y en ninguna parte decia que era: Pedro
   lo pregunto el 11-10 —«¿qué es ese punto verde al lado de la hora?»— y tenia
   razon, habia que adivinarlo. Un simbolo sin leyenda es decoracion para quien
   no lo sabe. */
function estadoTexto(a, publicado) {
  if (!a.trabajador_id) return 'Pendiente — todavía no tiene a nadie';
  return publicado ? 'Publicado — esta persona ya lo vio'
                   : 'Borrador — todavía no se lo has dicho a nadie';
}

function botonQuitar(a) {
  return '<button class="quitar-asig" data-quitar="' + a.id + '"'
       + ' title="Quitar este turno" aria-label="Quitar este turno">×</button>';
}

function pintarSuelta(a) {
  return '<div class="nec suelta ' + colorCargo(a.cargo_id) + '">'
    + '<div class="cab"><span class="cargo">' + esc(nombreCargo(a.cargo_id)) + '</span>'
    + '<span class="horas">' + rangoHtml(a.hora_inicio, a.hora_fin) + '</span>'
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
  /* Agrupado por CARGOS no hay fila de persona que marcar, así que la marca va
     en el nombre del bloque. Lo preguntó Pedro —«¿cómo se verá en la vista
     cargo?»— y la respuesta era: igual que cualquiera, que es el problema. */
  /* LA MARCA LLEVA LA FECHA, y no es un adorno.

     Primero puse solo «ya no trabaja aquí» y Pedro pregunto lo obvio: «¿desde
     cuando?». Y detras habia algo peor que un dato que falta: el turno es del
     lunes 5 y ella se fue el 8, o sea que ese turno SI lo trabajo — pero sin
     la fecha la pantalla se lee como una contradiccion, «no trabaja aqui pero
     tiene turno el lunes». Con «hasta el 08/10» las dos cosas encajan solas y
     ademas ocupa menos. */
  var quienEs = sinDueno ? null : S.trabajadores.filter(function (x) {
    return x.id === a.trabajador_id; })[0];
  var seFue = !!(quienEs && quienEs.activo === false);
  var hasta = seFue && quienEs.fecha_salida ? 'hasta el ' + diaMes(quienEs.fecha_salida)
                                            : 'ya no trabaja aquí';
  var pie = abajo === 'cargo' ? nombreCargo(a.cargo_id)
          : (sinDueno ? 'sin asignar' : nombreTrab(a.trabajador_id));
  return '<li class="blq ' + colorCargo(a.cargo_id)
       + (sinDueno ? ' pendiente' : (publicado ? ' publicado' : ' borrador'))
       + '" data-asigid="' + a.id + '"'
       + ' title="' + esc(estadoTexto(a, publicado)) + '">'
       + '<b>' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</b>'
       // Mismo formato H:MM que en todo el resto: dos maneras de escribir lo
       // mismo obligan a traducir mentalmente, y eso ya es un costo.
       + '<span class="dur">' + durTexto(a.hora_inicio, a.hora_fin) + '</span>'
       + '<em' + (seFue && abajo === 'persona'
            ? ' class="sefue" title="' + esc(pie + ' ya no trabaja aquí'
                + (quienEs.fecha_salida ? ' · su último día fue el '
                   + nombreDia(quienEs.fecha_salida) + ' ' + diaMes(quienEs.fecha_salida) : '')) + '"'
            : '')
       + '>' + esc(pie) + (seFue && abajo === 'persona' ? ' · ' + hasta : '')
       + '</em>' + botonQuitar(a) + '</li>';
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
    filas = conHistoria(S.asignaciones.filter(function (a) {
      return dias.indexOf(a.fecha) >= 0;
    })).map(function (p) {
      return { id: p.id, nombre: p.nombre, ido: p.activo === false, salida: p.fecha_salida };
    });
    // Lo pendiente no se esconde: tiene su propia fila al final.
    filas.push({ id: null, nombre: 'Sin asignar', suelto: true });
    deQuien = function (a) { return a.trabajador_id; };
  } else {
    filas = S.cargos.map(function (q) { return { id: q.id, nombre: q.nombre }; });
    deQuien = function (a) { return a.cargo_id; };
  }

  var hoy = hoyTexto();
  // `porpersona` la usa SOLO el papel: es la que decide si debajo de cada
  // nombre va una línea para firmar. Un cargo no firma.
  var html = '<table class="girada' + (S.agrupar === 'persona' ? ' porpersona' : '')
    + '"><thead><tr><th class="rot"></th>'
    + dias.map(function (f) {
        return '<th' + (f === hoy ? ' class="hoy"' : '') + '><b>' + nombreDia(f) + '</b>'
             + '<span>' + diaMes(f) + '</span></th>';
      }).join('')
    /* LAS HORAS TAMBIEN HACIA EL LADO, no solo hacia abajo.

       Lo pidio Pedro el 11-10: «falta el conteo de horas hacia al lado... solo
       esta hacia abajo». Tiene razon y son dos preguntas distintas: la fila de
       abajo dice QUE DIA esta flojo, y esta columna dice CUANTO LLEVA CADA UNO
       — que es la que decide si a alguien se le esta pasando la semana.

       Cuenta con LA MISMA REGLA que el pie, y eso no es un detalle: si una
       sumara los turnos sin dueño y la otra no, la suma de las filas no daria
       la suma de las columnas. Dos totales que no cuadran entre si no se
       discuten: se dejan de mirar los dos. */
    + '<th class="tot">Horas</th>'
    + '</tr></thead><tbody>';

  filas.forEach(function (fila) {
    var suma = 0;
    /* Quien ya no trabaja aqui sale igual SI tiene turnos esa semana, pero
       marcado: si se viera como los demas, el encargado le asignaria turnos
       nuevos sin darse cuenta de que esa persona ya no esta. */
    html += '<tr' + (fila.suelto ? ' class="suelto"' : (fila.ido ? ' class="ido"' : ''))
          + '><th class="rot">' + esc(fila.nombre)
          + (fila.ido ? '<span class="yano" title="Ya no trabaja aquí">'
              + (fila.salida ? 'hasta el ' + diaMes(fila.salida) : 'ya no trabaja aquí')
              + '</span>' : '') + '</th>';
    dias.forEach(function (f) {
      var suyas = S.asignaciones.filter(function (a) {
        return a.fecha === f && deQuien(a) === fila.id;
      }).sort(porHoraTurno);
      // La cara que NO es la fila: filas de personas → el puesto; filas de
      // cargos → quién lo hace.
      var abajo = S.agrupar === 'persona' ? 'cargo' : 'persona';
      /* La casilla se identifica por FILA Y FECHA, no por su posición ni por
         el elemento: la tabla se repinta entera a cada cambio y una referencia
         a un `<td>` se queda apuntando a algo que ya no está en la página. */
      // Solo lo que tiene persona, igual que `horasDeDia()`.
      suyas.forEach(function (a) {
        if (a.trabajador_id) suma += horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin));
      });
      html += '<td class="cel' + (f === hoy ? ' hoy' : '') + '"'
        + ' data-fila="' + esc(String(fila.id || '')) + '" data-fecha="' + f + '">'
        + (suyas.length
            ? '<ul class="gente bloques">'
              + suyas.map(function (a) { return pintarBloqueSemana(a, abajo); }).join('')
              + '</ul>'
            : '')
        /* LA CASILLA VACÍA ES UN BOTÓN.

           Lo encontró Pedro el 11-10 usándolo: marcó una casilla en la tabla
           por Cargos y preguntó «¿cómo agrego algo acá? No puedo desde esta
           vista». Tenía razón — desde esta tabla solo se podían ABRIR los
           turnos que ya estaban. Agregar obligaba a irse a «Por día».

           Es además lo que hace Skello, y estaba anotado desde el 03-10 en el
           registro de sus capturas: *«la casilla vacía es un botón Ajouter un
           shift, no un desplegable»*. Lo tenía escrito y no lo había hecho.

           Antes aquí iba un punto gris que no hacía nada. Un hueco que se
           puede llenar debería parecer que se puede llenar. */
        + '<button class="agregar-cel" data-agregar="1"'
        + ' title="Agregar un turno aquí" aria-label="Agregar un turno aquí">+</button>'
        + '</td>';
    });
    /* La fila «Sin asignar» marca raya y no cero: esos turnos existen, pero
       no son horas de nadie todavia. Un 0 ahi se leeria como «no hay nada». */
    html += '<td class="tot">'
          + (suma ? '<b>' + numero(suma) + ' h</b>' : '<span class="cero">—</span>')
          + '</td></tr>';
  });

  /* LAS HORAS VAN DENTRO DE LA TABLA, no en una banda debajo.

     Lo encontró Pedro el 11-10 (msg 5629): «mira las horas abajo no calzan con
     el día arriba». Los números estaban BIEN —los siete días y el total
     cuadraban— y aun así la pantalla mentía, porque «Dom 16 h» caía debajo de
     la columna del miércoles.

     La causa: la banda es un `<div>` aparte, con celdas de ancho fijo
     repartidas de izquierda a derecha, mientras que la tabla le da a cada día
     el ancho que pide su contenido — un martes sin turnos queda angosto. Dos
     repartos distintos del mismo eje no pueden coincidir, y cualquier arreglo
     a punta de márgenes se rompe al primer día que se llene.

     Metida como `<tfoot>`, cada número hereda el ancho de SU columna y queda
     pegado a su día pase lo que pase. Es el mismo motivo por el que la cifra
     vive en una tabla y no en una fila de cajas: el ancho lo manda una sola
     cosa. El total de la semana se va al encabezado de la fila, que es la
     única celda que no pertenece a ningún día. */
  var pieDentro = '';
  if (S.vista === 'semana') {
    var r = horasSemana();
    /* El total de la semana se va a la ESQUINA de abajo a la derecha, donde
       se cruzan la fila de totales y la columna de totales. Es el sitio que
       le corresponde en cualquier planilla, y ademas deja el encabezado de la
       fila libre para decir simplemente que es. */
    pieDentro = '<tfoot><tr><th class="rot">Horas repartidas</th>'
      + r.dias.map(function (d) {
          return '<td' + (d.fecha === hoy ? ' class="hoy"' : '') + '>'
               + (d.horas ? '<b>' + numero(d.horas) + ' h</b>'
                          : '<span class="cero">—</span>') + '</td>';
        }).join('')
      + '<td class="tot"><b>' + numero(r.total) + ' h</b>'
      + '<span>la semana</span></td>'
      + '</tr></tfoot>';
  }

  var m = $('#malla');
  m.className = 'malla girada';
  m.innerHTML = html + '</tbody>' + pieDentro + '</table>';
  // Lo marcado sobrevive al repintado porque vive por clave y no por elemento:
  // sin esto, pegar borraría la marca justo cuando se quiere pegar otra vez.
  pintarSeleccion();
  pintarPie(!!pieDentro);
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
  /* YA NO TE ECHA DEL MES.

     Aquí había un rebote: agrupar por persona o cargo en el Mes te devolvía a
     Semana con el aviso de que «serían 31 columnas». Ese argumento era mío y
     era flojo —Skello parte el mes en semanas, Deputy comprime la celda—, y el
     rebote era el verdadero defecto: te sacaba de donde habías decidido estar.

     Desde la v81 el Mes por persona o por cargo ES la vista B. Agrupado por día
     sigue siendo el calendario. Ninguna de las dos te expulsa. */
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
  /* AL PASAR A DÍA SE ATERRIZA EN LO QUE SE ESTABA MIRANDO.

     Lo encontró Pedro el 13-10 (msg 6170): planificando la semana del 26/10,
     apretar «Día» lo mandaba a «martes 13», que era hoy.

     La causa es una ASIMETRÍA. `mover()` en vista Día sí sincroniza las dos
     cosas —`S.lunes = lunesDe(S.dia)`—, pero al mover la SEMANA el día se queda
     donde estaba; y aquí solo se rellenaba `S.dia` cuando venía vacío, o sea
     con hoy. Así que la vista Día ignoraba por completo dónde estabas.

     Se CONSERVA el día si ya cae dentro de lo que se está mirando, y solo si no,
     se aterriza en el primero. Mandar siempre al lunes borraría el día elegido
     al ir y volver entre Día y Semana — peor que el error que arregla.

     `lunesDe()` en los dos lados a propósito: en vista Mes `S.lunes` es el día 1
     del mes y puede no ser lunes, así que se comparan SEMANAS, no textos. */
  if (S.vista === 'dia' && S.lunes && lunesDe(S.dia) !== lunesDe(S.lunes))
    S.dia = S.lunes;
  pintarSelectores(); recargarSemana();
});
/* Vuelve a ser lo que era: elegir local aquí es elegir QUÉ SE PLANIFICA, y
   nada más. Con las tarjetas, Configuración ya no depende de este selector —
   ese acoplamiento lo había metido yo y fue justo lo que confundió a Pedro. */
$('#cSucursal').addEventListener('change',  function () { S.sucursal = this.value; recargarSemana(); });

/* ---------- IMPRIMIR ----------

   Se imprime LO QUE SE ESTÁ VIENDO. No hay una «vista de impresión» aparte, y
   es a propósito: la hoja que Pedro va a pegar en la cocina es la misma malla
   que acaba de revisar en pantalla, y una segunda vista que arme el papel por
   su cuenta es una segunda vista que se puede quedar atrás sin que nadie lo
   note hasta tener el papel en la mano.

   Lo único que el papel necesita y la pantalla no es DECIR QUÉ ES: en pantalla
   el local y la semana están en la barra de arriba, y esa barra no se imprime.
   Sin esto queda una grilla de nombres y horas que no dice de qué local ni de
   qué semana es — inservible justo donde más se usa, pegada en un muro.

   Se arma en dos momentos porque hay dos maneras de llegar a imprimir: el
   botón, y el Ctrl+P que el navegador atiende sin pasar por el botón. Si solo
   lo llenara el botón, quien use Ctrl+P —que es casi todo el mundo— se llevaría
   la hoja sin encabezado. */
function prepararImpresion() {
  var caja = $('#cabImpresa'); if (!caja) return;
  var local = (S.sucursales.filter(function (s) { return s.id === S.sucursal; })[0] || {}).nombre || '';
  var comoSeAgrupa = S.agrupar === 'persona' ? 'por persona'
                   : (S.agrupar === 'cargo' ? 'por cargo' : 'por día');
  var hoy = hoyTexto();
  caja.innerHTML = '<b>' + esc(local) + '</b>'
    + '<span class="cuando">' + $('#cSemana').textContent.trim() + '</span>'
    + '<span class="como">Turnos ' + comoSeAgrupa
    + ' · impreso el ' + diaMes(hoy) + '</span>';
}
$('#btnImprimir').addEventListener('click', function () {
  prepararImpresion();
  window.print();
});
// Ctrl+P y el menú del navegador no pasan por el botón.
window.addEventListener('beforeprint', prepararImpresion);

$('#nav').addEventListener('click', function (ev) {
  var b = ev.target.closest('.tab'); if (!b) return;
  $$('#nav .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t === b)); });
  /* La lista de paneles sale de las PESTAÑAS que existen, no escrita a mano.

     Estaba escrita a mano y al agregar «Actividad» se me olvidó meterla: la
     pestaña se marcaba como elegida, las otras se escondían, y la nueva no se
     mostraba nunca — pantalla en blanco sin un solo error. Si la lista se
     deduce del menú, agregar una pestaña no puede volver a dejar su panel
     fuera. */
  $$('#nav .tab').forEach(function (t) {
    var panel = $('#t-' + t.dataset.p);
    if (panel) panel.hidden = (t.dataset.p !== b.dataset.p);
  });
  if (b.dataset.p === 'mio') pintarMios();
  // Se pide al entrar, no al arrancar: la bitácora puede ser larga y no
  // tiene por qué retrasar la pantalla que de verdad se usa.
  if (b.dataset.p === 'actividad') cargarActividad(false);
  /* El catalogo se lee AL ENTRAR a Configuracion, y tiene que estar aqui.

     Lo puse primero dentro de `pintarConfig()`, que parecia el sitio natural —
     y `pintarConfig()` NO se llama al cambiar de pestaña: corre una sola vez al
     arrancar, cuando todavia no se sabe si hay ausencias. Resultado: la
     pantalla salia vacia, sin un solo error en la consola. Es el mismo defecto
     contra el que avisa el comentario de aqui arriba, y lo encontro la prueba
     de humo, no yo. */
  if (b.dataset.p === 'config') { cargarCatalogo(); cargarBloqueos(); }
});

// Un solo oyente para toda la malla: los botones se repintan constantemente y
// enganchar uno por uno es como se queda un botón muerto sin que nadie lo note.
$('#malla').addEventListener('click', function (ev) {
  // El clic que cierra un arrastre no abre nada: la persona estaba marcando.
  if (SEL.tragarClic) return;
  var t = ev.target;
  /* EN EL MES, EL CLIC ABRE EL TURNO Y NO TE MUEVE.

     La primera versión llevaba a la semana al apretar cualquier casilla. Pedro
     lo probó y dijo «en mes, piche una casilla y me llevo a semana»; al buscar
     qué hacen los demás resultó que **llevarte a la semana no lo hace ninguno
     de los cuatro que yo pueda documentar — era un invento mío**. Lo que hacen
     es actuar ahí mismo (Skello edita en su mes, Deputy crea y publica) o no
     dejarte actuar (7shifts, solo lectura). Eligió C: abrir el turno ahí.

     El viaje a la semana sigue existiendo, pero como GESTO DELIBERADO: se
     aprieta el número de semana. Un clic en una casilla no te mueve la pantalla
     por accidente, y el mes no queda sin salida. */
  /* LA CASILLA VACIA DEL MES SIRVE PARA AGREGAR.

     Lo encontró Pedro con su malla de verdad (msg 5921): *«a beto, el 14 me lo
     enegrece, pero no me deja asignarle algo»*. Tenía razón y el defecto era de
     los peores: la casilla **se iluminaba y mostraba manito** —prometía que se
     podía apretar— **y no hacía nada**. Una pista falsa es peor que ninguna,
     porque quien la ve prueba, no pasa nada, y deja de confiar en el resto.

     Agregar desde el mes es además lo que hace Skello, que crea, modifica y
     borra turnos en su vista Mes. Preselecciona la fila, igual que el + de la
     semana: filas de personas → la persona; filas de cargos → el cargo. */
  var celVacia = t.closest && t.closest('.mesb td.d[data-fila]');
  if (celVacia && !t.closest('[data-asigid]')) {
    var quienMes = celVacia.dataset.fila || null;
    return abrirAsignacion(null, null, celVacia.dataset.dia,
      S.agrupar === 'persona' ? { trabajadorId: quienMes, fijo: quienMes ? 'persona' : null }
                              : { cargoId: quienMes,      fijo: quienMes ? 'cargo'   : null });
  }

  var semCab = t.closest && t.closest('.mesb [data-semana]');
  if (semCab) {
    S.lunes = semCab.dataset.semana;
    S.vista = 'semana';
    pintarSelectores(); pintarMalla();
    avisoPlan('');
    return;
  }
  /* La × antes que nada, y cortando el clic: vive DENTRO de la cabecera, que
     también es apretable, así que sin esto borrar abriría además la ficha. */
  if (t.dataset.borrarnec) {
    ev.stopPropagation();
    return borrarNecesidad(S.necesidades.filter(function (n) {
      return n.id === t.dataset.borrarnec; })[0]);
  }
  /* La × del turno, por el mismo motivo y antes que el `[data-asigid]` de más
     abajo: vive DENTRO del bloque apretable, así que sin cortar el clic
     quitaría el turno y además abriría la ficha del que acaba de irse. */
  if (t.dataset.quitar) {
    ev.stopPropagation();
    return quitarTurno(S.asignaciones.filter(function (x) {
      return x.id === t.dataset.quitar; })[0]);
  }
  /* El + de una casilla de la tabla. La fila dice QUÉ se preselecciona, y
     depende de cómo esté agrupado: filas de personas → la persona; filas de
     cargos → el cargo. Es la misma casilla, pero no significa lo mismo. */
  if (t.dataset.agregar) {
    ev.stopPropagation();
    var cel = t.closest('td.cel'); if (!cel) return;
    var quien = cel.dataset.fila || null;
    return abrirAsignacion(null, null, cel.dataset.fecha,
      S.agrupar === 'persona' ? { trabajadorId: quien, fijo: quien ? 'persona' : null }
                              : { cargoId: quien,      fijo: quien ? 'cargo'   : null });
  }
  if (t.dataset.nueva)  return abrirNecesidad(null, t.dataset.nueva);
  if (t.dataset.suelta) return abrirAsignacion(null, null, t.dataset.suelta);
  if (t.dataset.ausencia) return abrirAusencia(null, t.dataset.ausencia, null);
  var chip = t.closest && t.closest('.aus[data-ausid]');
  if (chip) {
    var ya = S.ausencias.filter(function (x) { return x.id === chip.dataset.ausid; })[0];
    if (ya) return abrirAusencia(ya, null, null);
  }
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
             + rangoTxt(h.hora_inicio, h.hora_fin) + '</option>';
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

/* El contador MIENTRAS SE ESCRIBE, en los dos diálogos.

   Es donde más falta hace: al teclear las horas uno quiere saber cuánto le
   está dando a alguien ANTES de guardar, no después de mirar la malla. */
function pintarDuracion(idEntra, idSale, idDonde) {
  var e = $(idEntra), x = $(idSale), d = $(idDonde);
  if (!e || !x || !d) return;
  if (!e.value || !x.value) { d.textContent = ''; return; }
  d.textContent = durTexto(e.value, x.value);
}
function pintarMedia() {
  $('#nMedia').hidden = !($('#nSale').value && $('#nEntra').value
                          && $('#nSale').value <= $('#nEntra').value);
  pintarDuracion('#nEntra', '#nSale', '#nDur');
}
['#nEntra', '#nSale'].forEach(function (sel) {
  // `input` y no solo `change`: con el reloj del navegador, `change` llega
  // tarde y el contador se queda atrás de lo que se está escribiendo.
  $(sel).addEventListener('input', pintarMedia);
  $(sel).addEventListener('change', pintarMedia);
});
['#aEntra', '#aSale'].forEach(function (sel) {
  var f = function () { pintarDuracion('#aEntra', '#aSale', '#aDur'); };
  $(sel).addEventListener('input', f);
  $(sel).addEventListener('change', f);
});

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

/* BORRAR UNA NECESIDAD. Una sola función para los dos caminos — la ficha y la
   × del bloque— porque son el mismo borrado. Si fueran dos, el día que se
   mejore el aviso habría que acordarse de mejorarlo dos veces, y es justo el
   error que me ha perseguido todo el día. */
function borrarNecesidad(n, dondeElError) {
  if (!n) return;
  var cuantas = S.asignaciones.filter(function (a) { return a.necesidad_id === n.id; }).length;
  // Decir cuánta gente queda suelta ANTES de borrar. Lo que no se avisa se
  // descubre cuando ya pasó. Y se dice QUÉ se borra, con nombre y hora: desde
  // la × del bloque uno puede haberle apuntado al de al lado.
  var que = '¿Borrar lo que hace falta en «' + nombreCargo(n.cargo_id) + '», '
          + rangoTxt(n.hora_inicio, n.hora_fin) + '?';
  var m = cuantas
    ? que + '\n\nTiene ' + cuantas + ' persona(s) asignada(s). Esas quedan como '
      + '«sin planificar», no se borran.'
    : que;
  if (!confirm(m)) return;
  var copia = JSON.parse(JSON.stringify(n));
  return DATOS.necesidades.borrar(n.id).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', n.id, 'borrar', copia, null);
    recordar('borrar ' + nombreCargo(copia.cargo_id), function () {
      return DATOS.necesidades.crear({
        empresa_id: copia.empresa_id, sucursal_id: copia.sucursal_id, fecha: copia.fecha,
        cargo_id: copia.cargo_id, hora_inicio: copia.hora_inicio, hora_fin: copia.hora_fin,
        personas_requeridas: copia.personas_requeridas });
    });
    $('#dlgNec').close(); return recargarSemana();
  }).catch(function (e) {
    if (dondeElError) aviso(dondeElError, e.message, 'bad'); else alert(e.message);
  });
}

$('#nBorrar').addEventListener('click', function () {
  borrarNecesidad(necActual, '#nMsg');
});

// ====================================================================
// ASIGNACIÓN
// ====================================================================
var asigPreset = null;
var asigActual = null, asigNecesidad = null, asigFecha = null;
var fichaBase = null;   // la foto de los campos al abrir, para saber si cambio algo

/* SE GUARDA AL CERRAR, Y NO SE ESCRIBE SI NO CAMBIO NADA.

   Lo eligio Pedro el 12-10 (msg 5880, opcion C), despues de preguntar que hacia
   el boton Guardar: «no es necesario apretar guardar en cada cambio... la
   planilla va teniendo como memoria». Su comparacion fue Google Sheets.

   DOS COSAS QUE NO SON COMO EN SHEETS, y por eso esto guarda AL CERRAR y no a
   cada tecla:

   1. En Sheets una celda es un valor solo. Aqui un turno son cuatro datos que
      solo tienen sentido juntos -cargo, persona, entra, sale-. Guardar a media
      edicion escribiria un turno imposible: la entrada ya cambiada y la salida
      todavia no.
   2. Sheets nunca rechaza lo que escribes. Aqui hay reglas -nadie en dos turnos
      a la vez, no se pisa una ausencia, el indice de no repetir-. Asi que si el
      guardado se bloquea, la ficha SE QUEDA ABIERTA y dice por que, en vez de
      cerrarse y perder lo escrito.

   Y lo que hace que «entrar a mirar» no cueste nada: si los campos estan igual
   que cuando se abrio, cerrar NO escribe -ni toca el contador de cambiadas, ni
   ocupa un paso de Deshacer-. Eso ademas arregla lo que le conte antes, que
   apretar Guardar sin cambiar nada escribia igual. */
function leerFicha() {
  return {
    trabajador_id: $('#aQuien').value || null,
    hora_inicio: $('#aEntra').value,
    hora_fin: $('#aSale').value,
    cargo_id: $('#aCargo').value || null,
  };
}
function fichaCambiada() {
  if (!fichaBase) return false;
  var h = leerFicha();
  return h.trabajador_id !== fichaBase.trabajador_id
      || h.hora_inicio !== fichaBase.hora_inicio
      || h.hora_fin !== fichaBase.hora_fin
      || h.cargo_id !== fichaBase.cargo_id;
}
/* `preset` lo manda la tabla por Personas o Cargos: dice de qué fila salió el
   clic, para que el turno nazca con la persona —o el cargo— de esa fila ya
   puesta. Sin esto, agregar desde la fila «Cocina» abría un turno de «Caja». */
function abrirAsignacion(a, necesidadId, fecha, preset) {
  asigActual = a || null;
  asigNecesidad = necesidadId || null;
  asigPreset = preset || null;
  var n = necesidadId ? S.necesidades.filter(function (x) { return x.id === necesidadId; })[0] : null;
  asigFecha = fecha || (n ? n.fecha : hoyTexto());

  $('#aTit').textContent = a ? 'Quién lo cubre' : 'Quién lo cubre';

  /* El cargo: lo manda la necesidad si la hay; si no, se PREGUNTA. Antes se
     tomaba el primero del catálogo en silencio. */
  /* Si sabemos PARA QUIEN es, el cargo por omisión sale de lo que esa persona
     hace. Antes salía «Caja» —el primero del catálogo— aunque el turno fuera
     para alguien que nunca ha estado en caja: lo vio Pedro al apretar el + en
     la fila de Catalina. Es la misma cortesía que ya hace la lista de
     personas, que pone arriba a los que tienen el cargo. Sugiere, no obliga:
     el desplegable sigue teniendo todos. */
  var cargoId = n ? n.cargo_id
              : (a ? a.cargo_id
                   : ((preset && preset.cargoId)
                      || cargoQueHace(preset && preset.trabajadorId)
                      || (S.cargos[0] || {}).id));
  /* QUE SE PUEDE CAMBIAR Y QUE NO, segun de donde vino el clic.

     Pedro lo pidio asi el 11-10 despues de probarlo: apreto el + en la fila
     de Ana, el desplegable le ofrecio a Camila, y aunque el turno terminaba
     correctamente en la fila de Camila le resulto raro —«deberia ser solo
     para elegir a ana»—. Tiene razon: en esa pantalla la fila YA ES la
     pregunta «¿de quien?», y volver a preguntarla abajo invita a
     contradecirla sin querer.

     La regla queda simetrica: desde la tabla por Personas, la persona es fija
     y se elige el cargo; desde la de Cargos, el cargo es fijo y se elige la
     persona — que ahi si es la pregunta de verdad: «quien cubre esto».
     Entrando por cualquier otro lado, las dos se eligen como siempre. */
  var fijaPersona = !!(preset && preset.fijo === 'persona' && preset.trabajadorId);
  var fijaCargo   = !!(preset && preset.fijo === 'cargo'   && preset.cargoId);

  $('#aCargoCaja').hidden = !!n;
  $('#aCargo').innerHTML = S.cargos.map(function (q) {
    return '<option value="' + q.id + '">' + esc(q.nombre) + '</option>';
  }).join('');
  if (cargoId) $('#aCargo').value = cargoId;
  var sabe = [], resto = [];
  activos().forEach(function (p) {
    var tiene = (p.trabajador_cargos || []).some(function (x) { return x.cargo_id === cargoId; });
    (tiene ? sabe : resto).push(p);
  });
  $('#aQuien').innerHTML = '<option value="">— dejar pendiente —</option>'
    + (sabe.length ? '<optgroup label="Hacen este cargo">' + sabe.map(opcion).join('') + '</optgroup>' : '')
    + (resto.length ? '<optgroup label="Los demás">' + resto.map(opcion).join('') + '</optgroup>' : '');

  $('#aQuien').value = a && a.trabajador_id ? a.trabajador_id
                     : ((preset && preset.trabajadorId) || '');
  $('#aEntra').value = a ? hhmm(a.hora_inicio) : (n ? hhmm(n.hora_inicio) : '09:00');
  $('#aSale').value  = a ? hhmm(a.hora_fin)    : (n ? hhmm(n.hora_fin)    : '17:00');
  pintarDuracion('#aEntra', '#aSale', '#aDur');
  $('#aBorrar').hidden = !a;
  aviso('#aMsg', '');
  // Lo fijo se muestra como texto, no como un desplegable apagado: un
  // desplegable gris se lee como «esto esta roto», no como «esto ya esta
  // decidido». El valor sigue puesto en el <select> escondido, que es de
  // donde lo lee el guardado.
  $('#aQuienCaja').hidden = fijaPersona;
  $('#aQuienFijo').hidden = !fijaPersona;
  if (fijaPersona) $('#aQuienFijo').innerHTML = '<b>' + esc(nombreTrab(preset.trabajadorId))
    + '</b> — apretaste el + en su fila';
  if (!n) {
    $('#aCargoCaja').hidden = fijaCargo;
    $('#aCargoFijo').hidden = !fijaCargo;
    if (fijaCargo) $('#aCargoFijo').innerHTML = '<b>' + esc(nombreCargo(preset.cargoId))
      + '</b> — apretaste el + en esa fila';
  } else {
    $('#aCargoFijo').hidden = true;
  }

  pintarDeQuien();
  pintarOjo();
  // La foto se toma con los campos YA puestos: si se tomara antes, abrir una
  // ficha prellenada contaria como «cambiaste algo» y escribiria sola.
  fichaBase = leerFicha();
  pintarSalida();
  $('#dlgAsig').showModal();
}

/* EL SUBTÍTULO DICE DÓNDE VA A CAER EL TURNO, y se vuelve a escribir cada vez
   que cambias la persona.

   Pedro apretó el + en la fila de Ana, cambió la persona a Catalina y guardó:
   el turno apareció en la fila de Catalina. Eso es lo correcto —el turno es de
   quien lo hace, no de la fila donde apretaste—, pero él lo contó como una
   sorpresa: *«me dio la opción pero no se guardó ahí»*. Y una sorpresa es un
   defecto aunque el resultado sea el correcto.

   La salida no es quitarle la libertad de cambiar la persona: es que VEA que
   el turno se está moviendo, antes de guardar. */
function pintarDeQuien() {
  var n = asigNecesidad ? S.necesidades.filter(function (x) { return x.id === asigNecesidad; })[0] : null;
  if (n) {
    $('#aDe').innerHTML = esc(nombreCargo(n.cargo_id)) + ' · '
      + rangoTxt(n.hora_inicio, n.hora_fin) + ' · '
      + nombreDia(n.fecha) + ' ' + diaMes(n.fecha);
    return;
  }
  var pid = $('#aQuien').value;
  var cid = $('#aCargo').value;
  var donde = (pid ? '<b>' + esc(nombreTrab(pid)) + '</b>' : '<b>Sin asignar</b>')
            + (cid ? ' · ' + esc(nombreCargo(cid)) : '')
            + (asigFecha ? ' · <b>' + nombreDia(asigFecha) + ' ' + diaMes(asigFecha) + '</b>' : '');

  /* ABRIR UN TURNO QUE YA EXISTE NO ES LO MISMO QUE CREAR UNO.

     Defecto mío, introducido esta misma tarde al hacer que la ficha dijera
     dónde iba a caer el turno: escribía «va a quedar en…» SIEMPRE, también
     al abrir uno que ya estaba. Pedro abrió uno de tres turnos de la misma
     casilla y la ficha parecía estar creando otro —y encima no decía CUÁL de
     los tres había abierto, que con dos de ellos a la misma hora es justo lo
     que hay que saber—.

     Al editar, lo primero que tiene que decir es QUÉ turno es. */
  if (asigActual) {
    $('#aDe').innerHTML = 'Estás abriendo el turno de <b>'
      // Sin la duración: `rangoTxt` agrega «· 8:00» y aquí ensucia la frase,
      // que ya lleva persona, cargo y día detrás.
      + esc(hhmm(asigActual.hora_inicio) + '–' + hhmm(asigActual.hora_fin)) + '</b> · ' + donde
      + '. Sin nada planificado detrás: sale marcado como «sin planificar».';
    return;
  }
  $('#aDe').innerHTML = '<b>Turno nuevo</b> — va a quedar en ' + donde
    + '. Sin nada planificado detrás: sale marcado como «sin planificar».';
}
function opcion(p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }

// El primer cargo que esa persona tiene marcado, o nada si no tiene ninguno.
function cargoQueHace(trabajadorId) {
  if (!trabajadorId) return null;
  var p = S.trabajadores.filter(function (x) { return x.id === trabajadorId; })[0];
  var suyos = (p && p.trabajador_cargos) || [];
  return suyos.length ? suyos[0].cargo_id : null;
}

/* El aviso cuando la persona no tiene ese cargo. AVISA, NO BLOQUEA: Pedro fue
   explícito —«igual un cajero podría tomar el trabajo de un mesero»—. */
/* Los avisos del dialogo. Son VARIOS y se juntan en una lista.

   Antes esto miraba una sola cosa —el cargo— y arrancaba con
   `if (!pid || !cargoId) return`. Ese retorno temprano tenia un efecto que no
   se ve leyendolo: en un TURNO SUELTO no hay necesidad detras, asi que no hay
   cargo, asi que la funcion se iba antes de mirar nada mas. El aviso de
   ausencia puesto despues de esa linea no se habria mostrado nunca justo en el
   caso mas probable de meter la pata.

   Ninguno impide guardar. Pedro fijo que la app avisa y no bloquea: el sabe
   cosas que la app no sabe. */
function pintarOjo() {
  var pid = $('#aQuien').value;
  var n = asigNecesidad ? S.necesidades.filter(function (x) { return x.id === asigNecesidad; })[0] : null;
  /* Sin necesidad detrás esto era `null`, así que el aviso de «no tiene ese
     cargo» NO SE MOSTRABA NUNCA en un turno suelto — justo donde es más fácil
     equivocarse, porque ahí nadie eligió el cargo por ti. Ahora mira el que
     está puesto en el desplegable. */
  var cargoId = n ? n.cargo_id : ($('#aCargo').value || null);
  var e = $('#aOjo');
  if (!pid) { e.hidden = true; return; }
  var p = S.trabajadores.filter(function (x) { return x.id === pid; })[0];
  var quien = esc(p ? p.nombre : '');
  var avisos = [];

  if (cargoId) {
    var tiene = (p && (p.trabajador_cargos || []).some(function (x) { return x.cargo_id === cargoId; }));
    if (!tiene) avisos.push('⚠️ <b>' + quien + '</b> no tiene marcado «'
      + esc(nombreCargo(cargoId)) + '». Puedes asignarlo igual.');
  }

  /* Dos turnos el mismo dia SIN pisarse — 08:00-16:00 y 16:00-23:00. Es
     legitimo (el turno partido existe y el esquema lo defiende), asi que se
     avisa y no se impide. Lo que SI se impide es que se pisen, y eso se revisa
     al guardar, contra la base: aqui solo esta la semana visible. */
  var mismoDia = S.asignaciones.filter(function (a) {
    return a.trabajador_id === pid && a.fecha === asigFecha
        && !(asigActual && a.id === asigActual.id);
  });
  if (mismoDia.length) {
    avisos.push('⚠️ <b>' + quien + '</b> ya tiene <b>' + mismoDia.length + ' turno'
      + (mismoDia.length === 1 ? '' : 's') + '</b> ese día ('
      + esc(mismoDia.map(function (a) { return hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin); }).join(', '))
      + '). Van a ser <b>dos turnos en el mismo día</b>.');
  }

  // El choque por DIA de calendario: no se comparan horas a proposito.
  ausenciasDe(pid, asigFecha).forEach(function (a) {
    avisos.push('⚠️ <b>' + quien + '</b> tiene <b>' + esc(nombreTipoAusencia(a.tipo_id))
      + '</b> ' + (a.desde === a.hasta ? 'ese día' : 'del ' + esc(diaMes(a.desde)) + ' al ' + esc(diaMes(a.hasta)))
      + (unidadDe(a) !== 'dia' ? ' <i>(no es el día entero)</i>' : '')
      + '. Puedes ponerle el turno igual, y queda registrado que fuiste tú.');
  });

  e.hidden = !avisos.length;
  e.innerHTML = avisos.join('<br>');
}
/* LA SALIDA SE TIENE QUE VER, Y DICE COSAS DISTINTAS EN CADA CASO.

   Lo encontro Pedro el 12-10 a las 17:06 probando la v79: entro por el + y la
   ficha le quedo con UN SOLO BOTON, «Listo», que crea el turno. Pregunto lo
   obvio: «por que aca no da la opcion de cerrar eso y que quede como esta?».

   Salida habia -Escape no crea nada- pero NADA en la pantalla lo decia, y un
   boton que no se ve es como si no existiera. Es el mismo error que ya costo una
   vez en este proyecto, cuando copiar y pegar existian solo por teclado y el
   escribio «no pude copiar pegar».

   La causa fue mia y concreta: puse «Descartar cambios» a aparecer solo cuando
   `fichaCambiada()`, y en un turno NUEVO no hay nada cambiado todavia.

   Ahora:
   · turno nuevo     -> «Cancelar» desde el principio. Cerrar no crea nada, y se ve.
   · turno existente -> «Descartar cambios» cuando se toco algo. Sin cambios,
                        cerrar no escribe, asi que no hay de que escapar. */
function pintarSalida() {
  var b = $('#aCancelar'), c = $('#aAuto');
  if (!b) return;
  if (!asigActual) {
    /* «Cerrar» lo pidió Pedro con esa palabra: «cerrar. es mas intuitivo»
       (msg 5901). */
    b.hidden = false;
    b.textContent = 'Cerrar';
    /* Y EL CARTEL TIENE QUE CAMBIAR CON ÉL. Decía «lo que cambies se guarda al
       cerrar», que en un turno nuevo CONTRADICE al botón: ahí cerrar no crea
       nada. Dos textos que se desmienten en la misma pantalla son peores que
       uno solo incompleto, porque no se sabe a cuál creerle. */
    if (c) c.innerHTML = '<b>Listo</b> crea el turno. <b>Cerrar</b> deja la casilla'
                       + ' como está.';
  } else {
    b.hidden = !fichaCambiada();
    /* Aquí NO se llama «Cerrar» a propósito, aunque él usara esa palabra: en un
       turno que ya existe, cerrar —con Listo o con Escape— GUARDA. Un botón que
       dijera «Cerrar» y además tirara los cambios sería la trampa de siempre,
       la pantalla diciendo una cosa y la acción haciendo otra. */
    b.textContent = 'Descartar cambios';
    if (c) c.innerHTML = 'Lo que cambies <b>se guarda al cerrar</b>.'
                       + ' <b>Deshacer</b> lo revierte.';
  }
}

function alCambiarFicha() {
  pintarDeQuien(); pintarOjo();
  pintarSalida();
}
$('#aQuien').addEventListener('change', alCambiarFicha);
// Cambiar el cargo también: el aviso depende de los dos, no solo de la persona.
$('#aCargo').addEventListener('change', alCambiarFicha);
// Y las horas, que son los otros dos campos que cuentan como cambio.
['#aEntra', '#aSale'].forEach(function (sel) {
  $(sel).addEventListener('change', alCambiarFicha);
  $(sel).addEventListener('input', alCambiarFicha);
});

/* DESCARTAR es lo único que cierra sin escribir. Cerrar de cualquier otra forma
   guarda, que es lo que pidió Pedro. */
$('#aCancelar').addEventListener('click', function () { fichaBase = null; $('#dlgAsig').close(); });

/* ESCAPE TAMBIÉN GUARDA. Si Escape descartara y «Listo» guardara, habría dos
   formas de cerrar con resultados distintos, y la persona no tendría cómo saber
   cuál le tocó. Se corta el cierre automático para decidir aquí: si el guardado
   se bloquea —el duplicado exacto que rechaza la base—, la ficha se queda
   abierta en vez de cerrarse perdiendo lo escrito. */
$('#dlgAsig').addEventListener('cancel', function (ev) {
  ev.preventDefault();
  cerrarFicha(false);
});

$('#aGuardar').addEventListener('click', function () { cerrarFicha(true); });

/* `explicito` es true cuando se apretó «Listo». Importa en un solo caso: entrar
   por el + y cerrar SIN TOCAR NADA. Con Escape no se crea el turno —apretar el
   + y arrepentirse no puede dejar un turno puesto—, pero con «Listo» sí, porque
   ahí la persona dijo que el prellenado le servía. */
/* UNA NECESIDAD DE UNA PERSONA ES EL TURNO DE ESA PERSONA.

   La regla la dio Pedro el 12-10 (msgs 5935-5941), con su foto delante: había
   creado «Caja 08:00–16:00, 1 persona», puesto a Ana, y al acortarla a las 14:30
   le quedó la tarjeta diciendo **Completo** y la línea marcando hora y media
   **sin asignar**. Su modelo: *«si creé la necesidad en un rango de horas y
   luego asigné a alguien, eso ya está cubierto; si edito el turno, se edita
   todo: la necesidad, la persona, las horas»*.

   Y el criterio con el que hay que juzgarlo, también suyo: *«la idea de
   necesidad, quién lo cubre, turno es simplemente para hacer uno poder
   planificar más fácil»*. No es una contabilidad que haya que cuadrar.

   SE LE PLANTEÓ EL RIESGO y lo descartó con razón: *«la persona que planifica
   sabe la hora de cierre del local; si esa persona no puede hasta las 4:00
   pondrá a otra»*. El cambio queda igualmente registrado en Actividad.

   ⚠️ POR QUE SOLO CON `personas_requeridas === 1`, y no con «una sola
   asignación»: en los datos de prueba hay una necesidad que pide **3** personas
   y tiene **una** asignada (n2, 17:00–23:00 con alguien de 17:00 a 20:00). Con
   la regla escrita a la ligera, esa necesidad se habría encogido a las 20:00
   **estando a dos personas de cubrirse** — justo el hueco que no se puede
   perder. Lo pilló mirar los datos antes de escribir la regla, no después.

   Con dos o más personas la necesidad sigue siendo un tramo propio y «cubrir
   solo un trozo» sigue valiendo, que es donde esa función sirve de verdad.

   ⚠️⚠️ ESTA REGLA VALE PARA NECESIDADES DECLARADAS A MANO, Y HAY QUE APAGARLA
   EL DIA QUE LAS CALCULE UN PRONOSTICO.

   Pedro dijo el rumbo del producto el 12-10 (msg 5945): *«yo entiendo esto igual
   que los otros, con la única diferencia que por el momento lo declaro a mano
   porque no tenemos ventas reales ni POS, pero en esencia deberíamos funcionar
   igual a ellos en el futuro»*. O sea la necesidad es **el pronóstico puesto a
   mano**, y asi es como lo tienen 7shifts -Optimal Labor Tool, gente por hora
   desde el historico de ventas- y Deputy.

   Mientras el pronostico sea EL, que acortar el turno acorte la necesidad es
   correcto: las dos cosas las decide en el mismo momento. Pero un pronostico
   calculado es un DATO DE ENTRADA y un turno no puede reescribirlo: si Ana se va
   a las 14:30, el historico sigue diciendo que el local necesitaba hasta las
   16:00, y **ahi ese hueco es justo lo que se quiere ver**.

   Asi que el dia que haya POS, esta funcion se limita a las necesidades de
   origen manual o se retira. Queda escrito aqui para que nadie la extienda sin
   darse cuenta. */
function alinearNecesidad(fila) {
  if (!fila || !fila.necesidad_id) return Promise.resolve();
  var n = S.necesidades.filter(function (x) { return x.id === fila.necesidad_id; })[0];
  if (!n || n.personas_requeridas !== 1) return Promise.resolve();

  var hermanas = S.asignaciones.filter(function (a) {
    return a.necesidad_id === n.id && a.id !== fila.id;
  });
  if (hermanas.length) return Promise.resolve();

  if (hhmm(n.hora_inicio) === hhmm(fila.hora_inicio)
   && hhmm(n.hora_fin) === hhmm(fila.hora_fin)) return Promise.resolve();

  var antes = { hora_inicio: n.hora_inicio, hora_fin: n.hora_fin };
  return DATOS.necesidades.guardar(n.id, {
    hora_inicio: fila.hora_inicio, hora_fin: fila.hora_fin,
  }).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'necesidad', n.id, 'editar',
                 Object.assign({ id: n.id }, antes),
                 { id: n.id, hora_inicio: fila.hora_inicio, hora_fin: fila.hora_fin });
    /* El deshacer tiene que devolver LAS DOS COSAS. Si solo repusiera el turno,
       la necesidad se quedaría encogida y el hueco no volvería: deshacer habría
       dejado la pantalla en un estado que nunca existió. */
    recordar('las horas de ' + nombreCargo(n.cargo_id), function () {
      return DATOS.necesidades.guardar(n.id, antes).then(function () {
        return DATOS.asignaciones.guardar(fila.id, {
          hora_inicio: antes.hora_inicio, hora_fin: antes.hora_fin });
      });
    });
  }).catch(function () { /* que falle esto no puede deshacer el turno ya guardado */ });
}

function cerrarFicha(explicito) {
  if (!fichaCambiada() && (asigActual || !explicito)) {
    fichaBase = null; $('#dlgAsig').close();
    return Promise.resolve();
  }
  return guardarFicha();
}

function guardarFicha() {
  var n = asigNecesidad ? S.necesidades.filter(function (x) { return x.id === asigNecesidad; })[0] : null;
  var d = {
    empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal,
    necesidad_id: asigNecesidad || null,
    trabajador_id: $('#aQuien').value || null,
    fecha: asigFecha,
    hora_inicio: $('#aEntra').value, hora_fin: $('#aSale').value,
    // Sin necesidad detrás, el cargo es el que eligió la persona en el
    // desplegable — no el primero del catálogo, que era lo de antes.
    cargo_id: n ? n.cargo_id : ($('#aCargo').value || (S.cargos[0] || {}).id),
    // Lo puso una persona: ningún generador automático lo va a pisar.
    origen: 'mano', tocado_a_mano: true, estado: 'confirmada',
  };
  if (!d.cargo_id) return aviso('#aMsg', 'Primero crea un cargo en Equipo.', 'bad');
  if (!d.hora_inicio || !d.hora_fin) return aviso('#aMsg', 'Faltan las horas.', 'bad');

  aviso('#aMsg', 'Revisando…');
  return revisarChoque(d).then(function (choque) {
    return guardarAsignacion(d).then(function (bien) {
      /* El aviso del cruce va DESPUÉS de guardar y FUERA de la ficha, porque la
         ficha ya se cerró. Si fuera antes sería una pregunta disfrazada; así es
         lo que es: ya quedó hecho, y aquí está lo que conviene saber. */
      if (bien !== false && choque) avisoPlan('⚠️ <b>Guardado con un cruce.</b> '
        + choque + ' Queda marcado <b>«se cruza»</b> en la semana.');
      return bien;
    });
  }).catch(function (e) { aviso('#aMsg', e.message, 'bad'); return false; });
}

/* ¿Se pisa con otro turno de esa misma persona? Devuelve el mensaje, o null.

   Se pregunta a la BASE y no a la pantalla: la pantalla tiene solo la semana
   visible —y un turno del domingo anterior que cruza la medianoche entra en el
   lunes— y ademas la pantalla es de UN local, y nadie puede estar en dos
   locales a la misma hora.

   AL EDITAR, el turno no puede chocar consigo mismo: se saca de la lista. Sin
   eso, mover el turno de Ana de las 14:00 a las 15:00 se bloquearia solo. */
function revisarChoque(d) {
  if (!d.trabajador_id) return Promise.resolve(null);
  var ayer = masDias(d.fecha, -1), manana = masDias(d.fecha, 1);
  return DATOS.asignaciones.deLaPersona(d.trabajador_id, ayer, manana).then(function (otros) {
    var pisa = null, min = 0;
    otros.forEach(function (o) {
      if (asigActual && o.id === asigActual.id) return;
      var m = minutosQueSePisan(d, o);
      if (m > min) { min = m; pisa = o; }
    });
    if (!pisa) return null;
    /* YA NO ES UNA NEGATIVA, ES UN AVISO. Lo decidió Pedro el 12-10, y es su
       propio principio de la malla: «avisa, no bloquea». Antes esta frase
       empezaba con «No puede estar en dos turnos a la vez» y la pantalla se
       negaba a guardar; ahora se guarda y queda marcado «se cruza» en la
       semana, que es un marcado que ya existía para los cruces heredados. */
    return 'Se cruza <b>' + minTexto(min)
      + '</b> con su turno de ' + esc(rangoTxt(pisa.hora_inicio, pisa.hora_fin))
      + ' del ' + esc(nombreDia(pisa.fecha)) + ' ' + esc(diaMes(pisa.fecha)) + '.';
  });
}

/* DEVUELVE SU PROMESA. Antes no la devolvía y quien la llamaba no tenía forma de
   saber si había terminado — ni de decir algo después, como el aviso del cruce. */
/* ====================================================================
   PONER A ALGUIEN YA ES DECLARAR QUE HACÍA FALTA
   ====================================================================
   Pedro, 13-10 (msgs 6239–6245): *«si sé que necesito a Ana a tal hora, tal
   día, ¿por qué debería agregarle un paso extra?»* · *«al poner a Ana ahí,
   implícitamente declaré que hacía falta»*.

   DOS CAMINOS, NO UN ORDEN OBLIGATORIO. Declarar la necesidad primero sigue
   existiendo y sirve para lo que de verdad sirve: pedir gente que todavía no
   tienes —«faltan 3 cajeros y no sé quiénes»—. Pero **no es un peaje**: si ya
   sabes a quién pones, lo pones.

   Y esto hace desaparecer «sin planificar» como estado corriente, que es lo que
   le extrañó al verlo (msg 6235) — con razón: la etiqueta describía un trámite
   pendiente que él nunca había querido hacer.

   SE BUSCA ANTES DE CREAR, por día + cargo + las dos horas. Si Ana y Beto
   quedan los dos en Caja de 09:00 a 17:00, eso es UNA necesidad de dos
   personas y no dos necesidades de una — que es como lo diría cualquiera. */
function necesidadQueCalza(fecha, cargo_id, hi, hf) {
  return S.necesidades.filter(function (x) {
    return x.fecha === fecha && x.cargo_id === cargo_id
        && hhmm(x.hora_inicio) === hhmm(hi) && hhmm(x.hora_fin) === hhmm(hf);
  })[0] || null;
}

function necesidadImplicita(a, avisarCreada) {
  /* UN TURNO PENDIENTE TAMBIÉN DECLARA. Lo eligió Pedro el 13-10 (msg 6260)
     cuando se le planteó el caso que su regla no cubría: *«un turno sin dueño
     ES un hueco que alguien abrió»*. Así que no hace falta que tenga persona —
     basta con que el turno exista—. Queda «Falta 1» hasta que alguien lo tome,
     que es justo lo que se quiere ver. */
  if (!a || a.necesidad_id) return Promise.resolve(a);

  var ya = necesidadQueCalza(a.fecha, a.cargo_id, a.hora_inicio, a.hora_fin);
  var p = ya ? Promise.resolve(ya) : DATOS.necesidades.crear({
    empresa_id: a.empresa_id, sucursal_id: a.sucursal_id, fecha: a.fecha,
    cargo_id: a.cargo_id, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
    personas_requeridas: 1
  }).then(function (fila) { if (avisarCreada) avisarCreada(fila.id); return fila; });

  return p.then(function (n) {
    return DATOS.asignaciones.guardar(a.id, { necesidad_id: n.id }).then(function () {
      a.necesidad_id = n.id;
      /* LO PEDIDO ES, AL MENOS, CUÁNTOS TURNOS CUELGAN. Se cuentan TODOS, con
         persona y sin ella, y ahí está el porqué: si Ana ya creó una necesidad
         de 1 y después abres un turno pendiente en el mismo tramo, pedir 1
         diría «Completo» con un hueco abierto debajo. Son dos puestos: uno
         cubierto y uno no. Contando los pendientes queda «Falta 1», que es lo
         que pasa de verdad.

         Y por eso se cuentan turnos y no personas: el que está vacío también
         ocupa un puesto. Lo cubierto lo calcula `estadoNecesidad()` aparte. */
      var colgados = S.asignaciones.filter(function (x) {
        return x.necesidad_id === n.id && x.id !== a.id;
      }).length + 1;
      if (colgados > (n.personas_requeridas || 1))
        return DATOS.necesidades.guardar(n.id, { personas_requeridas: colgados });
    });
  }).catch(function () { /* que falle esto no puede botar el turno ya guardado */ });
}

function guardarAsignacion(d) {
  aviso('#aMsg', 'Guardando…');
  var p = asigActual ? DATOS.asignaciones.guardar(asigActual.id, d) : DATOS.asignaciones.crear(d);
  var antesA = asigActual && JSON.parse(JSON.stringify(asigActual));
  /* Se declara aquí y se rellena después: el deshacer se registra antes de que
     la necesidad exista, pero la función de deshacer corre más tarde y para
     entonces ya está puesta. Sin esto, deshacer dejaría el día pidiendo gente
     que nadie pidió. */
  var necCreada = null;
  return p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', fila.id, asigActual ? 'editar' : 'crear', asigActual, fila);
    if (antesA) recordar('el cambio en el turno', function () {
      return DATOS.asignaciones.guardar(antesA.id, {
        trabajador_id: antesA.trabajador_id, hora_inicio: antesA.hora_inicio,
        hora_fin: antesA.hora_fin, cargo_id: antesA.cargo_id });
    });
    else recordar('asignar a ' + (fila.trabajador_id ? nombreTrab(fila.trabajador_id) : 'pendiente'),
      function () {
        return DATOS.asignaciones.borrar(fila.id).then(function () {
          // y la necesidad que nació de este turno se va con él
          return necCreada ? DATOS.necesidades.borrar(necCreada).catch(function () {}) : null;
        });
      });
    fichaBase = null;
    $('#dlgAsig').close();
    return necesidadImplicita(fila, function (id) { necCreada = id; })
      .then(function () { return alinearNecesidad(fila); })
      .then(function () {
        return recargarSemana().then(function () { return true; });
      });
  }).catch(function (e) {
    /* DEVUELVE false Y DEJA LA FICHA ABIERTA. Lo segundo es lo que importa: si
       se cerrara, la persona perdería lo que escribió por un choque que todavía
       puede arreglar. Y lo primero evita que después se anuncie un cruce
       «guardado» que en realidad no se guardó.

       El índice único es el que impide duplicar el MISMO bloque. Se traduce,
       porque el texto de Postgres no le dice nada a nadie. */
    if (/asignaciones_sin_repetir/.test(e.message)) {
      aviso('#aMsg', 'Esa persona ya tiene un turno que empieza a esa hora ese día.'
                   + ' Cambia la hora de entrada.', 'bad');
      return false;
    }
    aviso('#aMsg', e.message, 'bad');
    return false;
  });
}

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

/* QUITAR UN TURNO DE UN SOLO CLIC, desde la malla y sin abrir la ficha.

   LA REGLA LA DIO PEDRO con estas palabras (11-10, msg 5633): «si está
   publicado, pregunta.. si estoy planificando se borra y ya». No es comodidad:
   es la diferencia real entre los dos estados. Un borrador no se le ha dicho a
   nadie todavía y preguntar por cada uno convierte el botón en un estorbo
   justo en el momento en que más se usa —armando la semana—. Un turno
   publicado, en cambio, ES lo que esa persona ya leyó y con lo que organizó su
   semana; quitarlo se lo borra del calendario.

   POR QUÉ EL BORRADOR IGUAL SE PUEDE DESHACER. Borrar sin preguntar está bien
   mientras exista vuelta atrás; si no, el primer clic equivocado le cuesta a
   Pedro rehacer el turno de memoria. Esa red ya existía en la aplicación
   —Deshacer— y lo único que faltaba era que este camino también la usara.
   El aviso se queda corto solo en una cosa, y conviene saberlo: lo que repone
   Deshacer es un turno con los mismos datos, no la misma fila; si estaba
   publicado, hay que volver a publicarlo. */
function quitarTurno(a) {
  if (!a) return;
  var publicado = S.turnos.some(function (t) {
    return t.asignacion_id === a.id && t.estado === 'publicado';
  });
  var quien = a.trabajador_id ? nombreTrab(a.trabajador_id) : 'Sin asignar';
  if (publicado && !confirm(
        'Este turno YA ESTÁ PUBLICADO:\n\n'
        + quien + ' · ' + nombreDia(a.fecha) + ' ' + diaMes(a.fecha)
        + ' · ' + rangoTxt(a.hora_inicio, a.hora_fin) + '\n\n'
        + 'Quitarlo se lo borra del calendario. ¿Lo quito?')) return;

  // La copia se saca ANTES: después de borrar, `a` sigue en memoria pero la
  // fila ya no está, y es lo único con que se puede reponer.
  var copia = JSON.parse(JSON.stringify(a));
  return DATOS.turnos.borrarDe([a.id]).catch(function () {})
    .then(function () { return DATOS.asignaciones.borrar(a.id); })
    .then(function () {
      DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', a.id, 'borrar', copia, null);
      recordar('quitar el turno de ' + quien, function () {
        return DATOS.asignaciones.crear({
          empresa_id: copia.empresa_id, sucursal_id: copia.sucursal_id,
          necesidad_id: copia.necesidad_id, trabajador_id: copia.trabajador_id,
          fecha: copia.fecha, hora_inicio: copia.hora_inicio,
          hora_fin: copia.hora_fin, cargo_id: copia.cargo_id,
          origen: copia.origen, tocado_a_mano: true,
          propuesta_id: copia.propuesta_id, estado: copia.estado });
      });
      return recargarSemana();
    })
    // El error se DICE. Aquí no hay diálogo abierto donde dejar el aviso, y un
    // turno que sigue en pantalla después de apretar la × parece un botón
    // muerto cuando en realidad fue la base la que no dejó.
    .catch(function (e) { alert('No pude quitar el turno: ' + e.message); });
}

/* ================== LA MALLA COMO UNA PLANILLA ==================

   Pedido por Pedro el 11-10 (msg 5642): «copiar y pegar lo seleccionado o
   enegrecido». Es lo último que le faltaba del proyecto anterior, donde ya lo
   había pedido con estas palabras: «la planilla debería aceptar enegrecer,
   copiar pegar… se debería poder navegar en la planilla como si fuera una
   planilla excel».

   LA DECISIÓN QUE ORDENA TODO LO DEMÁS: ningún gesto que ya funciona cambia de
   significado. Un clic en un bloque sigue abriendo la ficha y la × sigue
   quitando el turno. Lo único que se suma es que cualquier clic ADEMÁS marca
   la casilla, y que arrastrar desde el fondo de una casilla —no desde un
   bloque, que ese ya hace otra cosa— pinta un rango.

   Se descartó lo de Excel, «un clic marca y dos clics editan»: el clic que
   abre la ficha es el gesto más repetido de esta pantalla, y cambiarle el
   significado le rompería la mano a Pedro por una función que todavía no sabe
   que existe.

   SOLO EN LA TABLA (Personas y Cargos). «Por día» son tarjetas, no una
   rejilla, y ahí no hay casillas que marcar.

   LA MARCA VIVE POR CLAVE, no por elemento: la tabla se repinta entera a cada
   cambio y una referencia a un `<td>` se queda apuntando a algo que ya no está
   en la página.

   Y LA CLAVE LLEVA LA AGRUPACIÓN ADENTRO. Las dos rejillas se parecen —filas
   por persona, filas por cargo— pero una casilla significa cosas distintas en
   cada una. Sin el prefijo, lo copiado en Personas se podría pegar en Cargos,
   donde querría decir otra cosa. */

var SEL = { claves: [], ancla: null, foco: null, pintando: false, arrastro: false, tragarClic: false, ctrlClic: false };
var PORTA = null;   // lo copiado: { agrupar, alto, ancho, celdas: [[ [turnos] ]] }

function esPlanilla() { return S.agrupar === 'persona' || S.agrupar === 'cargo'; }

function claveCel(td) {
  return S.agrupar + '|' + (td.dataset.fila || '') + '|' + td.dataset.fecha;
}
function partesClave(k) {
  var i = k.indexOf('|'), j = k.lastIndexOf('|');
  return { agrupar: k.slice(0, i), fila: k.slice(i + 1, j), fecha: k.slice(j + 1) };
}

/* LO MARCADO SIGUE AL GESTO (12-10-2026).

   Hasta la v74 la unidad de selección era SOLO la casilla, y eso tenía un
   defecto peligroso, no estético: en una casilla con tres turnos, el clic
   sobre uno ABRÍA ese turno pero MARCABA LA CASILLA ENTERA. La pantalla
   afirmaba que tenías uno entre manos y en realidad tenías tres — apretar
   `Supr` ahí borraba los tres. Lo encontró Pedro el 11-10 y tuvo que insistir.

   Desde aquí `SEL.claves` admite DOS tipos de entrada:
     · `persona|<fila>|<fecha>`  → una casilla completa, como siempre
     · `turno|<id>`              → un turno suelto

   Todo lo que consume la selección pasa por `turnosDeClave` y `posDeClave`,
   así que ninguna de las dos necesita saber cuál de los dos tipos le tocó. */
function claveTurno(id) { return 'turno|' + id; }
function esClaveTurno(k) { return String(k).slice(0, 6) === 'turno|'; }

function asigDeClave(k) {
  var id = String(k).slice(6);
  return S.asignaciones.filter(function (a) { return String(a.id) === id; })[0] || null;
}

/* En qué casilla vive un turno, en la agrupación que esté puesta ahora. Es la
   misma cuenta que hace `turnosDeClave` al revés, y la necesitan copiar y
   pegar, que trabajan sobre un rectángulo de casillas. */
function claveCelDeAsig(a) {
  var fila = S.agrupar === 'persona' ? (a.trabajador_id || '') : (a.cargo_id || '');
  return S.agrupar + '|' + fila + '|' + a.fecha;
}

/* La geometría se saca del DOM EN EL MOMENTO del gesto. Las filas no son una
   rejilla regular —está la de «Sin asignar» y el pie de horas— así que contar
   `<tr>` no sirve: se numeran solo las que tienen casillas. */
function rejilla() {
  var t = document.querySelector('#malla table.girada');
  if (!t) return null;
  var filas = $$('tbody tr', t).map(function (tr) { return $$('td.cel', tr); })
                               .filter(function (c) { return c.length; });
  var mapa = {};
  filas.forEach(function (cels, f) {
    cels.forEach(function (td, c) { mapa[claveCel(td)] = { f: f, c: c, td: td }; });
  });
  return { filas: filas, mapa: mapa };
}

/* Los turnos que hay en una casilla. En la rejilla de personas es «lo de Ana
   el lunes»; en la de cargos, «todo lo de Cocina el lunes», que puede ser de
   varias personas a la vez y también de nadie. */
/* EL ORDEN DE LOS TURNOS DE UNA CASILLA, EN UN SOLO SITIO.

   Lo encontró Pedro el 12-10 después de pegar: en la casilla de Caja le quedó
   el de 14:00 ARRIBA del de 09:00, y al repintarse cambiaron de orden también
   casillas que él no había tocado. La causa: `turnosDeClave` ordenaba por hora
   y **el dibujo no ordenaba nada** —salía el orden en que volvían de la base—,
   así que la misma casilla tenía dos órdenes distintos según quién preguntara.

   Esta lección ya estaba aprendida en `celdaDia`, que ordena desde hace
   semanas y lo dejó escrito. La rejilla semanal nunca la recibió. Por eso la
   regla vive **aquí y una sola vez**, y la usan los tres sitios que dibujan
   turnos: si el día que se agregue un cuarto hay que elegir orden otra vez,
   volvemos a tener dos.

   Y DESEMPATA HASTA EL FINAL. Con dos turnos a la misma hora —que es normal:
   Fernanda y Tomás a las 09:00— ordenar solo por hora_inicio deja el empate en
   manos del orden de llegada, y entonces la casilla se reordena sola en cada
   repintado sin que nadie haya cambiado nada. El `id` al final hace el orden
   total y estable. */
function porHoraTurno(u, v) {
  var a = hhmm(u.hora_inicio), b = hhmm(v.hora_inicio);
  if (a !== b) return a < b ? -1 : 1;
  var c = hhmm(u.hora_fin), d = hhmm(v.hora_fin);
  if (c !== d) return c < d ? -1 : 1;
  return String(u.id) < String(v.id) ? -1 : 1;
}

function turnosDeClave(k) {
  // Un turno suelto se resuelve solo; si ya no existe, la selección se queda
  // sin él en vez de reventar.
  if (esClaveTurno(k)) { var uno = asigDeClave(k); return uno ? [uno] : []; }
  var p = partesClave(k);
  return S.asignaciones.filter(function (a) {
    var mio = p.agrupar === 'persona' ? (a.trabajador_id || '') : (a.cargo_id || '');
    return a.fecha === p.fecha && String(mio) === p.fila;
  }).sort(porHoraTurno);
}

/* La posición en la rejilla de cualquiera de las dos claves. Un turno suelto
   vale por la casilla donde está dibujado. */
function posDeClave(g, k) {
  if (!esClaveTurno(k)) return g.mapa[k];
  var a = asigDeClave(k);
  return a ? g.mapa[claveCelDeAsig(a)] : null;
}

/* Los turnos de una casilla QUE ESTÁN MARCADOS. Si la casilla entera está
   marcada, son todos; si no, solo los sueltos que caen dentro. Es lo que
   impide que copiar una selección de un turno se lleve los tres de la
   casilla, que es el mismo engaño que se vino a arreglar. */
function turnosMarcadosEn(k) {
  if (SEL.claves.indexOf(k) >= 0) return turnosDeClave(k);
  return SEL.claves.filter(esClaveTurno).map(asigDeClave).filter(function (a) {
    return a && claveCelDeAsig(a) === k;
  });
}

function limpiarSeleccion() {
  SEL.claves = []; SEL.ancla = null;
  pintarSeleccion();
}

function pintarSeleccion() {
  $$('#malla td.cel').forEach(function (td) {
    var k = claveCel(td);
    var marcada = SEL.claves.indexOf(k) >= 0;
    td.classList.toggle('sel', marcada);
    /* EL ANCLA SOLO SE PINTA SI LA CASILLA ESTÁ MARCADA DE VERDAD.

       Al marcar un turno suelto se guarda igual su casilla como ancla —hace
       falta para que Mayús extienda un rango desde ahí— y eso se estaba
       DIBUJANDO: la casilla salía con su borde verde aunque no estuviera
       seleccionada. Lo vio Pedro en la v75 el 12-10: «ahora sí puedo
       seleccionar el turno pero igual enegrece la casilla completa».

       El borde no mentía sobre la selección interna, pero daba en pantalla
       exactamente la misma impresión que el defecto que se vino a arreglar —y
       en una pantalla, lo que la persona cree es el único resultado que hay. */
    td.classList.toggle('ancla', marcada && k === SEL.ancla);
  });
  /* Y los turnos sueltos se marcan uno por uno. Sin esto el arreglo sería
     invisible: la selección sería correcta por dentro y la pantalla seguiría
     sin decir qué hay marcado, que es justo el problema que se arregla. */
  $$('#malla .blq').forEach(function (li) {
    var id = li.dataset && li.dataset.asigid;
    li.classList.toggle('selturno', !!id && SEL.claves.indexOf(claveTurno(id)) >= 0);
  });
  avisarSeleccion();
}

function marcarRango(desde, hasta) {
  var g = rejilla(); if (!g) return;
  var a = g.mapa[desde], b = g.mapa[hasta];
  if (!a || !b) return;
  var f1 = Math.min(a.f, b.f), f2 = Math.max(a.f, b.f);
  var c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
  SEL.claves = [];
  for (var f = f1; f <= f2; f++)
    for (var c = c1; c <= c2; c++)
      if (g.filas[f] && g.filas[f][c]) SEL.claves.push(claveCel(g.filas[f][c]));
  pintarSeleccion();
}

/* LA BARRA DE ABAJO. Sin ella, la marca es un recuadro de color que no le
   avisa a nadie que ahora puede apretar Ctrl+C: la función existiría y no la
   encontraría nadie. Es el mismo problema que tuvo «Horario libre…» en el
   proyecto anterior, escondido donde nadie lo buscaba. */
function avisarSeleccion(mensaje) {
  var caja = $('#selAviso'); if (!caja) return;
  if (mensaje) {
    caja.hidden = false; caja.classList.remove('pista');
    caja.innerHTML = '<b class="dice">' + esc(mensaje) + '</b>';
    return;
  }

  /* SIN NADA MARCADO, LA BARRA ENSEÑA QUE ESTO EXISTE.

     Antes aparecía solo después de marcar — y para marcar hay que saber que
     se puede. Pedro abrió la aplicación recién publicada y escribió «no pude
     copiar pegar»: la función estaba entera y no había forma de descubrirla.

     Y el primer tropiezo fue peor que eso: la pantalla ABRE en «Por día», que
     es tarjetas y no una rejilla, así que probó donde no existía. Por eso ahí
     la barra no se calla: dice dónde está. Un cartel es más barato que una
     función que nadie encuentra. */
  if (!SEL.claves.length) {
    var enTabla = esPlanilla() && S.vista === 'semana';
    var enTarjetas = S.vista === 'semana' && S.agrupar === 'dia';
    if (!enTabla && !enTarjetas) { caja.hidden = true; return; }
    caja.hidden = false; caja.classList.add('pista');
    caja.innerHTML = enTabla
      ? '<span class="teclas">Arrastra sobre las casillas para marcarlas y cópialas'
        + ' con <b>Ctrl+C</b> y <b>Ctrl+V</b>. <b>Supr</b> las quita.'
        + ' Un clic sobre un turno marca <b>ese</b> turno; <b>Ctrl+clic</b> suma.</span>'
      : '<span class="teclas">Para copiar y pegar turnos, cambia a'
        + ' <b>Personas</b> o <b>Cargos</b>.</span>';
    return;
  }
  caja.classList.remove('pista');
  caja.hidden = false;
  /* LA CUENTA NO PUEDE MENTIR. Antes decía siempre «N casillas», también
     cuando lo marcado era un turno suelto — y esa frase es justo la que hacía
     creer que `Supr` iba a quitar una cosa cuando iba a quitar tres. */
  var casillas = SEL.claves.filter(function (k) { return !esClaveTurno(k); }).length;
  var sueltos = SEL.claves.length - casillas;
  var turnos = SEL.claves.reduce(function (t, k) { return t + turnosDeClave(k).length; }, 0);
  var que = casillas && sueltos
      ? '<b>' + casillas + '</b> ' + (casillas === 1 ? 'casilla' : 'casillas')
        + ' y <b>' + sueltos + '</b> ' + (sueltos === 1 ? 'turno suelto' : 'turnos sueltos')
      : (sueltos
          ? '<b>' + sueltos + '</b> ' + (sueltos === 1 ? 'turno' : 'turnos')
          : '<b>' + casillas + '</b> ' + (casillas === 1 ? 'casilla' : 'casillas'));
  caja.innerHTML = que
    + ' · <b>' + turnos + '</b> ' + (turnos === 1 ? 'turno' : 'turnos')
    + '<span class="teclas">Ctrl+C copiar · Ctrl+X cortar · Ctrl+V pegar'
    + ' · Supr quitar · Esc soltar</span>'
    + (PORTA ? (function () {
         var cp = PORTA.celdas.reduce(function (t, f) {
           return t + f.reduce(function (u, c) { return u + c.length; }, 0); }, 0);
         return '<em>copiado: ' + PORTA.alto + '×' + PORTA.ancho
              + ' (' + cp + (cp === 1 ? ' turno' : ' turnos') + ')</em>';
       })() : '');
}
function decirSel(texto) {
  avisarSeleccion(texto);
  setTimeout(function () { if (!SEL.pintando) pintarSeleccion(); }, 2200);
}
// Decir algo (o nada) y salir, siempre con una promesa en la mano.
function nada(texto) {
  if (texto) decirSel(texto);
  return Promise.resolve();
}

// ---------- copiar ----------
function copiarSeleccion(cortar) {
  if (!SEL.claves.length) return decirSel('Marca primero qué quieres copiar.');
  var g = rejilla(); if (!g) return;
  var fs = [], cs = [];
  SEL.claves.forEach(function (k) { var p = posDeClave(g, k); if (p) { fs.push(p.f); cs.push(p.c); } });
  if (!fs.length) return;
  var f1 = Math.min.apply(null, fs), f2 = Math.max.apply(null, fs);
  var c1 = Math.min.apply(null, cs), c2 = Math.max.apply(null, cs);
  var celdas = [], necs = {};
  for (var f = f1; f <= f2; f++) {
    var linea = [];
    for (var c = c1; c <= c2; c++) {
      var td = g.filas[f] && g.filas[f][c];
      /* `turnosMarcadosEn` y no `turnosDeClave`: si marcaste UN turno de una
         casilla que tiene tres, se copia ese y no los tres. */
      /* SE COPIA TAMBIÉN LO QUE HACÍA FALTA, no solo quién trabajaba.

         Pedro eligió esto el 13-10 (msg 6237, opción B) después de preguntar
         por qué un día pegado salía «sin planificar»: el portapapeles llevaba
         los turnos y **no** la necesidad, así que todo lo pegado nacía sin
         nadie que hubiera declarado que hiciera falta.

         Se guarda el `necesidad_id` de origen y, aparte, la necesidad entera.
         Al pegar se vuelve a crear en el día de destino. Con el POS esto habrá
         que revisarlo —copiar un pronóstico no tendrá sentido— y él lo dijo
         con todas sus letras: *«cuando el POS calcule, revisamos todas esas
         cosas… pero ahora B queda mejor»*. */
      linea.push(!td ? [] : turnosMarcadosEn(claveCel(td)).map(function (a) {
        if (a.necesidad_id && !necs[a.necesidad_id]) {
          var n = S.necesidades.filter(function (x) { return x.id === a.necesidad_id; })[0];
          if (n) necs[a.necesidad_id] = { cargo_id: n.cargo_id, hora_inicio: n.hora_inicio,
                                          hora_fin: n.hora_fin,
                                          personas_requeridas: n.personas_requeridas };
        }
        return { hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
                 cargo_id: a.cargo_id, trabajador_id: a.trabajador_id,
                 necesidad_id: a.necesidad_id || null };
      }));
    }
    celdas.push(linea);
  }
  PORTA = { agrupar: S.agrupar, alto: f2 - f1 + 1, ancho: c2 - c1 + 1,
            celdas: celdas, necesidades: necs };
  if (cortar) return borrarSeleccion(true);
  avisarSeleccion();
}

// ---------- pegar ----------
/* PEGAR REEMPLAZA lo que haya en la casilla de destino, como en Excel. Sumar
   encima sería más «seguro» y es peor: copiar un lunes sobre un martes que ya
   tenía gente dejaría al martes con el doble de turnos y nadie entendería de
   dónde salieron. */
/* DEVUELVE SIEMPRE UNA PROMESA, también cuando no hace nada. Media función que
   a veces devuelve promesa y a veces no obliga a quien la llama a preguntarse
   cuál de las dos le tocó — y el que se olvide se lleva un error en una rama
   que casi nunca pasa. Lo encontré probando el caso de la ausencia. */
function pegarSeleccion() {
  if (!PORTA) return nada('No hay nada copiado todavía.');
  if (PORTA.agrupar !== S.agrupar)
    return nada(PORTA.agrupar === 'persona'
      ? 'Eso lo copiaste agrupado por persona. Vuelve a Personas para pegarlo.'
      : 'Eso lo copiaste agrupado por cargo. Vuelve a Cargos para pegarlo.');
  if (!SEL.claves.length) return nada('Marca primero dónde quieres pegar.');
  var g = rejilla(); if (!g) return nada();

  /* SI LO MARCADO ES MÁS GRANDE QUE LO COPIADO, SE REPITE HASTA LLENARLO.

     Lo encontró Pedro el 13-10 a los diez minutos de usar el menú (msg 6201):
     copió el lunes, marcó la semana entera y **solo le pegó el martes**.

     Y el código lo hacía A PROPÓSITO: aquí decía que se pega en la esquina de
     arriba a la izquierda «igual que una planilla». Pero una planilla, cuando
     copias UNA casilla y marcas un rango, RELLENA EL RANGO. La regla se había
     justificado con una comparación que no se sostiene justo en el caso más
     corriente — copiar un día y repartirlo en la semana.

     Dos condiciones para repetir, y las dos son por prudencia:

     · Lo marcado tiene que ser un RECTÁNGULO LLENO. Con Ctrl+clic se puede
       marcar en damero, y ahí rellenar el rectángulo que los contiene
       escribiría en casillas que nadie marcó.
     · Y múltiplo exacto en las dos direcciones. Si no calza, se pega una vez
       y SE DICE: hacer a medias algo que parece completo es peor que no
       hacerlo. */
  var fs = [], cs = [], marcadas = {};
  SEL.claves.forEach(function (k) {
    var p = posDeClave(g, k);
    if (p) { fs.push(p.f); cs.push(p.c); marcadas[p.f + '|' + p.c] = true; }
  });
  if (!fs.length) return nada();
  var f0 = Math.min.apply(null, fs), c0 = Math.min.apply(null, cs);
  var altoSel  = Math.max.apply(null, fs) - f0 + 1;
  var anchoSel = Math.max.apply(null, cs) - c0 + 1;

  var lleno = Object.keys(marcadas).length === altoSel * anchoSel;
  var calza = lleno && altoSel % PORTA.alto === 0 && anchoSel % PORTA.ancho === 0;
  var vecesF = calza ? altoSel / PORTA.alto  : 1;
  var vecesC = calza ? anchoSel / PORTA.ancho : 1;
  // Marcó más de lo que cabe y no se pudo repetir: hay que avisarlo al final.
  var noCalzo = !calza && (altoSel > PORTA.alto || anchoSel > PORTA.ancho);

  var crear = [], borrar = [], fuera = 0, dormidos = 0, revividos = 0;
  for (var rf = 0; rf < vecesF; rf++) {
  for (var rc = 0; rc < vecesC; rc++) {
  for (var i = 0; i < PORTA.alto; i++) {
    for (var j = 0; j < PORTA.ancho; j++) {
      var ff = f0 + rf * PORTA.alto + i, cc = c0 + rc * PORTA.ancho + j;
      var td = g.filas[ff] && g.filas[ff][cc];
      if (!td) { fuera++; continue; }
      var k = claveCel(td), p = partesClave(k);

      /* UNA AUSENCIA NO SE PISA. Si alguien está de vacaciones, pegarle un
         turno encima es justo lo que el resto de la aplicación impide; que
         aquí entrara por la puerta de atrás haría inútil el control. */
      if (p.agrupar === 'persona' && p.fila && ausenciasDe(p.fila, p.fecha).length) {
        dormidos++; continue;
      }
      turnosDeClave(k).forEach(function (a) { borrar.push(a); });
      PORTA.celdas[i][j].forEach(function (t) {
        /* QUIEN YA NO TRABAJA AQUI NO REVIVE AL PEGAR.

           Encontrado el 11-10 probándolo: copiando una semana vieja y
           pegándola en la siguiente, el turno de alguien que ya se fue se
           creaba de nuevo a su nombre. La malla se habría llenado sola de
           gente que no está, por el camino más normal del mundo — copiar la
           semana pasada es justo lo que uno hace.

           No se descarta el turno: pasa SIN DUEÑO. Las horas y el cargo hacen
           falta igual; lo que ya no sirve es la persona. Así el hueco queda a
           la vista en vez de desaparecer, y se cuenta abajo. */
        var suyo = p.agrupar === 'persona' ? (p.fila || null) : (t.trabajador_id || null);
        if (suyo && !S.trabajadores.some(function (x) {
              return x.id === suyo && x.activo !== false; })) {
          suyo = null; revividos++;
        }
        crear.push({
          empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal,
          // Se resuelve justo antes de crearlo: hay que saber qué necesidad
          // quedó en el día de destino, y eso depende de lo que ya hubiera.
          _necOrigen: t.necesidad_id || null,
          necesidad_id: null,
          // La cara que manda es la de la FILA de destino; la otra viaja con
          // lo copiado. Pegar en la fila de Ana hace que el turno sea de Ana.
          trabajador_id: suyo,
          cargo_id:      p.agrupar === 'cargo'   ? p.fila : t.cargo_id,
          fecha: p.fecha, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin,
          origen: 'mano', tocado_a_mano: true, estado: 'confirmada',
        });
      });
    }
  }
  } }

  if (!crear.length && !borrar.length) {
    return nada(dormidos ? 'Ahí hay ausencias: no le pego turnos encima.'
                         : 'No había nada que pegar.');
  }

  avisarSeleccion('Pegando…');
  var nacidos = [];
  var cadena = borrar.reduce(function (pr, a) {
    return pr.then(function () {
      return DATOS.turnos.borrarDe([a.id]).catch(function () {})
        .then(function () { return DATOS.asignaciones.borrar(a.id); });
    });
  }, Promise.resolve());
  /* LA NECESIDAD EN EL DÍA DE DESTINO: se busca y solo si no está, se crea.

     Buscar primero no es un adorno. Sin eso, pegar dos veces sobre el mismo
     día duplicaría la demanda —«hacen falta 2» pasaría a «hacen falta 4»— sin
     que nada en la pantalla explicara de dónde salió. Se considera la misma si
     coinciden el día, el cargo y las dos horas. */
  var necNuevas = [], mapaNec = {};
  /* `base` sale de dos sitios y el resto es idéntico:
       · del PORTAPAPELES, si lo copiado ya colgaba de una necesidad — así una
         de 3 personas sigue siendo de 3 en el destino y el hueco no se pierde;
       · del PROPIO TURNO, si venía suelto — por la regla de Pedro, ponerlo ya
         declara que hacía falta, así que nace con una de 1.
     Un turno PENDIENTE no declara nada y se queda sin necesidad. */
  function asegurarNecesidad(fecha, idOrigen, suelto) {
    var base = idOrigen ? (PORTA.necesidades && PORTA.necesidades[idOrigen])
                        : suelto;
    if (!base) return Promise.resolve(null);
    var k = fecha + '|' + base.cargo_id + '|' + hhmm(base.hora_inicio) + '|' + hhmm(base.hora_fin);
    if (mapaNec[k]) return Promise.resolve(mapaNec[k]);
    var ya = S.necesidades.filter(function (x) {
      return x.fecha === fecha && x.cargo_id === base.cargo_id
          && hhmm(x.hora_inicio) === hhmm(base.hora_inicio)
          && hhmm(x.hora_fin)    === hhmm(base.hora_fin);
    })[0];
    if (ya) { mapaNec[k] = ya.id; return Promise.resolve(ya.id); }
    return DATOS.necesidades.crear({
      empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal, fecha: fecha,
      cargo_id: base.cargo_id, hora_inicio: base.hora_inicio,
      hora_fin: base.hora_fin, personas_requeridas: base.personas_requeridas
    }).then(function (fila) {
      mapaNec[k] = fila.id; necNuevas.push(fila.id); return fila.id;
    }).catch(function () { return null; });   // sin necesidad el turno igual entra
  }

  crear.forEach(function (d) {
    cadena = cadena.then(function () {
      var orig = d._necOrigen; delete d._necOrigen;
      // Suelto, con persona o sin ella: el turno mismo declara el puesto.
      var suelto = (!orig)
        ? { cargo_id: d.cargo_id, hora_inicio: d.hora_inicio,
            hora_fin: d.hora_fin, personas_requeridas: 1 }
        : null;
      // Un choque con el índice único no bota el pegado entero: se cuenta y
      // se sigue. Parar a la mitad dejaría la semana por la mitad, que es peor
      // que pegar casi todo y decir cuántos no entraron.
      return ((orig || suelto) ? asegurarNecesidad(d.fecha, orig, suelto)
                              : Promise.resolve(null))
        .then(function (nid) { if (nid) d.necesidad_id = nid; })
        .then(function () { return DATOS.asignaciones.crear(d); })
        .then(function (fila) { nacidos.push(fila); })
        .catch(function () { fuera++; });
    });
  });

  return cadena.then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', null, 'crear', null,
                 { pegado: nacidos.length, quitados: borrar.length });
    /* Deshacer de un pegado: se van los que nacieron y vuelven los que se
       fueron. Sin esto, pegar sobre la semana equivocada se arregla a mano
       turno por turno — y es la operación que más turnos mueve de una vez. */
    recordar('pegar en ' + (crear.length ? nacidos.length : borrar.length) + ' turno(s)',
      function () {
        var v = nacidos.reduce(function (pr, fila) {
          return pr.then(function () { return DATOS.asignaciones.borrar(fila.id); });
        }, Promise.resolve());
        /* Y SE VAN TAMBIÉN LAS NECESIDADES QUE NACIERON DEL PEGADO. Si solo se
           borraran los turnos, deshacer dejaría el día pidiendo gente que nadie
           pidió — un estado que nunca existió, que es el mismo defecto que ya
           se corrigió en `alinearNecesidad()`. Solo las nuevas: una que ya
           estaba ahí no la trajo este pegado y no le toca irse. */
        necNuevas.forEach(function (id) {
          v = v.then(function () { return DATOS.necesidades.borrar(id).catch(function () {}); });
        });
        borrar.forEach(function (a) {
          v = v.then(function () {
            return DATOS.asignaciones.crear({
              empresa_id: a.empresa_id, sucursal_id: a.sucursal_id,
              necesidad_id: a.necesidad_id, trabajador_id: a.trabajador_id,
              fecha: a.fecha, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
              cargo_id: a.cargo_id, origen: a.origen, tocado_a_mano: true,
              estado: a.estado });
          });
        });
        return v;
      });
    return recargarSemana();
  }).then(function () {
    var dice = 'Pegados ' + nacidos.length + ' turno(s)';
    if (vecesF * vecesC > 1) dice += ' · repetido ' + (vecesF * vecesC) + ' veces para llenar lo marcado';
    /* Se dice POR QUÉ no se repitió. Sin esto, marcar cinco días y ver que se
       llenó uno solo parece un fallo —que es exactamente lo que le pareció a
       Pedro, y tenía razón—. El aviso convierte una sorpresa en una regla. */
    if (noCalzo) dice += ' · marcaste más de lo copiado, pero no calza un número'
                       + ' entero de veces: pegué una sola';
    if (revividos) dice += ' · ' + revividos + ' quedaron sin asignar: esa persona ya no trabaja aquí';
    if (dormidos) dice += ' · ' + dormidos + ' casilla(s) con ausencia, intactas';
    if (fuera)    dice += ' · ' + fuera + ' no entraron';
    decirSel(dice);
  }).catch(function (e) { decirSel('No pude pegar: ' + e.message); });
}

// ---------- quitar lo marcado ----------
/* La misma regla de la ×, pero preguntando UNA sola vez por todo el lote: un
   diálogo por turno en una selección de veinte es un castigo, no un resguardo.
   Y se dice cuántos de los marcados ya están publicados, que es el dato con el
   que se decide. */
function borrarSeleccion(callado) {
  var todos = [];
  SEL.claves.forEach(function (k) { turnosDeClave(k).forEach(function (a) { todos.push(a); }); });
  if (!todos.length) return nada(callado ? null : 'No hay turnos en lo que marcaste.');
  var publicados = todos.filter(function (a) {
    return S.turnos.some(function (t) {
      return t.asignacion_id === a.id && t.estado === 'publicado';
    });
  }).length;
  if (publicados && !confirm(
        'Vas a quitar ' + todos.length + ' turno(s), y ' + publicados
        + ' de ellos YA ESTÁN PUBLICADOS.\n\n'
        + 'A esas personas se les borra de su calendario. ¿Los quito?')) return nada();

  avisarSeleccion('Quitando…');
  var idos = todos.map(function (a) { return JSON.parse(JSON.stringify(a)); });
  var cadena = todos.reduce(function (pr, a) {
    return pr.then(function () {
      return DATOS.turnos.borrarDe([a.id]).catch(function () {})
        .then(function () { return DATOS.asignaciones.borrar(a.id); });
    });
  }, Promise.resolve());
  return cadena.then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', null, 'borrar',
                 { quitados: idos.length }, null);
    recordar('quitar ' + idos.length + ' turno(s)', function () {
      return idos.reduce(function (pr, a) {
        return pr.then(function () {
          return DATOS.asignaciones.crear({
            empresa_id: a.empresa_id, sucursal_id: a.sucursal_id,
            necesidad_id: a.necesidad_id, trabajador_id: a.trabajador_id,
            fecha: a.fecha, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
            cargo_id: a.cargo_id, origen: a.origen, tocado_a_mano: true,
            estado: a.estado });
        });
      }, Promise.resolve());
    });
    return recargarSemana();
  }).then(function () {
    decirSel('Quitados ' + idos.length + ' turno(s)');
  }).catch(function (e) { decirSel('No pude quitar: ' + e.message); });
}

/* ====================================================================
   DEJAR SIN ASIGNAR — quitarle la persona al turno sin borrar el turno
   ====================================================================
   Es la opción que Skello tiene como «Unassigned» (verificado en su manual el
   11-10). Importa porque el caso corriente no es «este turno sobra», es «este
   turno sigue haciendo falta y esta persona ya no puede». Borrarlo y volver a
   crearlo pierde el turno; esto conserva el hueco, que es justo lo que la
   pantalla sabe mostrar. */
function dejarSinAsignar() {
  var todos = [];
  SEL.claves.forEach(function (k) {
    turnosDeClave(k).forEach(function (a) { if (a.trabajador_id) todos.push(a); });
  });
  if (!todos.length) return nada('En lo que marcaste no hay turnos con persona.');

  /* El publicado se avisa, igual que al borrar: a esa persona ya se le dijo que
     trabajaba, y quitarle el nombre se lo deshace. */
  var publicados = todos.filter(function (a) {
    return S.turnos.some(function (t) {
      return t.asignacion_id === a.id && t.estado === 'publicado';
    });
  }).length;
  if (publicados && !confirm(
        'Vas a dejar sin asignar ' + todos.length + ' turno(s), y ' + publicados
        + ' ya están PUBLICADOS.\n\n'
        + 'A esas personas se les quita de su calendario, pero el turno se queda '
        + 'en la malla esperando a alguien. ¿Lo hago?')) return nada();

  avisarSeleccion('Dejando sin asignar…');
  var antes = todos.map(function (a) { return { id: a.id, quien: a.trabajador_id }; });
  var cadena = todos.reduce(function (pr, a) {
    return pr.then(function () {
      return DATOS.turnos.borrarDe([a.id]).catch(function () {})
        .then(function () {
          return DATOS.asignaciones.guardar(a.id, { trabajador_id: null });
        });
    });
  }, Promise.resolve());

  return cadena.then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'asignacion', null, 'editar',
                 { sin_asignar: antes.length }, null);
    recordar('dejar sin asignar ' + antes.length + ' turno(s)', function () {
      return antes.reduce(function (pr, x) {
        return pr.then(function () {
          return DATOS.asignaciones.guardar(x.id, { trabajador_id: x.quien });
        });
      }, Promise.resolve());
    });
    return recargarSemana();
  }).then(function () {
    decirSel(antes.length + ' turno(s) quedaron esperando a alguien');
  }).catch(function (e) { decirSel('No pude: ' + e.message); });
}

/* ====================================================================
   EL MENÚ DEL BOTÓN DERECHO
   ====================================================================
   Pedro, 13-10-2026 (msgs 6180–6191), tras ver la maqueta.

   LO QUE HACE QUE VALGA LA PENA no es tener las acciones del teclado en un
   menú: es que SE VEAN. Copiar, cortar, pegar y borrar existen desde la v75 y
   solo por teclado — él mismo escribió «no pude copiar pegar» con la función
   entera hecha. El botón derecho es donde la gente va a BUSCAR qué se puede
   hacer con lo que tiene delante.

   Tres reglas, las dos primeras heredadas del menú de la malla:

   · Si lo que se aprieta está FUERA de la selección, se selecciona eso primero
     —como Excel y como cualquier explorador de archivos—. Abrir un menú que
     opera sobre otra cosa es la forma más rápida de borrar lo que no era.
   · Lo que no se puede hacer sale APAGADO, no escondido. Un menú que cambia de
     largo según el caso no se aprende nunca; uno que siempre tiene las mismas
     filas, sí. Y «Pegar» apagado además ENSEÑA que existe.
   · Cada fila lleva su atajo a la derecha. Esa es la otra mitad: el menú no
     reemplaza al teclado, lo enseña.

   SOLO EN LA REJILLA Y EN LA SEMANA, que es donde vive la selección. En las
   tarjetas no hay casillas, así que «pegar aquí» no tendría dónde. */
var MENU = { td: null, x: 0, y: 0 };

function menuEl() {
  var m = $('#menuCel');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'menuCel'; m.className = 'menucel'; m.hidden = true;
  m.setAttribute('role', 'menu');
  document.body.appendChild(m);
  /* Un solo escuchador y la acción en el propio botón: el menú se vuelve a
     dibujar entero cada vez que se abre, así que colgarle escuchadores a cada
     fila sería acumular basura. */
  m.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-acc]');
    if (!b || b.disabled) return;
    var td = MENU.td;                 // se guarda ANTES de cerrar
    cerrarMenu();
    switch (b.dataset.acc) {
      case 'agregar':
        if (!td) return;
        var quien = td.dataset.fila || null;
        return abrirAsignacion(null, null, td.dataset.fecha,
          S.agrupar === 'persona' ? { trabajadorId: quien, fijo: quien ? 'persona' : null }
                                  : { cargoId: quien,      fijo: quien ? 'cargo'   : null });
      /* Marcar no cierra la conversación: se vuelve a abrir el menú en el
         mismo sitio, ya con lo nuevo marcado. Si se cerrara, marcar y copiar
         serían dos clics derechos seguidos sobre lo mismo — y el menú está
         justo para ahorrar ese tipo de paso que hay que adivinar. */
      case 'marcarcel':
        if (!td) return;
        SEL.claves = [claveCel(td)]; SEL.ancla = SEL.claves[0]; SEL.pintando = false;
        pintarSeleccion();
        return abrirMenu(MENU.x, MENU.y, td, null);
      case 'marcarfila':
        if (!td) return;
        SEL.claves = [].slice.call($$('#malla td.cel')).filter(function (x) {
          return (x.dataset.fila || '') === (td.dataset.fila || '');
        }).map(claveCel);
        SEL.ancla = SEL.claves[0]; SEL.pintando = false;
        pintarSeleccion();
        return abrirMenu(MENU.x, MENU.y, td, null);
      case 'copiar':  return copiarSeleccion(false);
      case 'cortar':  return copiarSeleccion(true);
      case 'pegar':   return pegarSeleccion();
      case 'soltar':  return dejarSinAsignar();
      case 'borrar':  return borrarSeleccion(false);
    }
  });
  return m;
}

function cerrarMenu() {
  var m = $('#menuCel');
  if (m) { m.hidden = true; m.innerHTML = ''; }
  MENU.td = null;
}

function abrirMenu(x, y, td, idTurno) {
  /* REGLA 1: lo apretado entra en la selección si estaba fuera. */
  var k = idTurno ? claveTurno(idTurno) : claveCel(td);
  if (SEL.claves.indexOf(k) < 0) {
    SEL.ancla = claveCel(td); SEL.claves = [k]; SEL.pintando = false;
    pintarSeleccion();
  }

  var marcados = [];
  SEL.claves.forEach(function (c) { turnosDeClave(c).forEach(function (a) { marcados.push(a); }); });
  var conPersona = marcados.filter(function (a) { return a.trabajador_id; }).length;

  var fila = function (acc, txt, tecla, puede, clase) {
    return '<button data-acc="' + acc + '"' + (puede ? '' : ' disabled') + ''
         + (clase ? ' class="' + clase + '"' : '') + '>'
         + '<span>' + txt + '</span>'
         + (tecla ? '<span class="k">' + tecla + '</span>' : '') + '</button>';
  };

  var m = menuEl();
  MENU.td = td;
  /* MARCAR LA CASILLA Y MARCAR LA FILA.

     Pedro perdió trabajo con esto el 13-10 (msg 6209): marcó dos turnos de una
     misma casilla apretándolos uno tras otro, y el segundo REEMPLAZA al primero
     —hay que usar Ctrl+clic—, así que copió uno creyendo que copiaba dos.

     El comportamiento era el correcto y estaba documentado. Daba igual: la
     diferencia entre apretar EL TURNO y apretar EL FONDO de la casilla no se ve
     en ninguna parte. Es exactamente lo que este menú existe para destapar.

     ⚠️ SE LLAMA «los turnos de esta casilla» Y NO «la casilla entera», y el
     nombre lo corrigió Pedro (msg 6218): *«lo que tiene sentido es marcar el
     turno, más que la casilla»*. Tiene razón en el fondo — para copiar y para
     borrar la unidad YA es el turno—; la casilla solo es imprescindible como
     DESTINO al pegar. Así que la función se queda y lo que cambió es la
     palabra: la fila habla de turnos, que es como lo piensa quien la usa. */
  var kCel = claveCel(td);
  var tdsFila = [].slice.call($$('#malla td.cel')).filter(function (x) {
    return (x.dataset.fila || '') === (td.dataset.fila || '');
  });
  m.innerHTML =
      fila('agregar', 'Agregar turno aquí', '', true)
    + '<hr>'
    + fila('marcarcel',  'Marcar los turnos de esta casilla', '',
           !(SEL.claves.length === 1 && SEL.claves[0] === kCel))
    + fila('marcarfila', 'Marcar toda la fila', '', tdsFila.length > 1)
    + '<hr>'
    + fila('copiar',  'Copiar',  'Ctrl+C', marcados.length > 0)
    + fila('cortar',  'Cortar',  'Ctrl+X', marcados.length > 0)
    + fila('pegar',   'Pegar',   'Ctrl+V', !!PORTA)
    + '<hr>'
    + fila('soltar',  'Dejar sin asignar', '', conPersona > 0)
    + fila('borrar',  'Borrar',  'Supr',  marcados.length > 0, 'mal');
  m.hidden = false;

  /* Se mide DESPUÉS de dibujarlo y se corrige si se sale: un menú cortado por
     el borde de la ventana deja opciones que existen y no se pueden apretar. */
  var an = m.offsetWidth, al = m.offsetHeight;
  MENU.x = x; MENU.y = y;        // para poder reabrirlo donde estaba
  var maxX = window.scrollX + document.documentElement.clientWidth  - an - 8;
  var maxY = window.scrollY + document.documentElement.clientHeight - al - 8;
  m.style.left = Math.max(window.scrollX + 8, Math.min(x, maxX)) + 'px';
  m.style.top  = Math.max(window.scrollY + 8, Math.min(y, maxY)) + 'px';
}

$('#malla').addEventListener('contextmenu', function (ev) {
  if (!esPlanilla() || S.vista !== 'semana') return;   // sólo donde hay rejilla
  var td = ev.target.closest && ev.target.closest('td.cel');
  if (!td) return;
  ev.preventDefault();
  var blq = ev.target.closest('.blq');
  abrirMenu(ev.pageX, ev.pageY, td, blq && blq.dataset ? blq.dataset.asigid : null);
});

/* Se cierra con cualquier cosa que signifique «ya no». El `mousedown` va en
   captura para ganarle al de la malla, que empieza a pintar una selección. */
document.addEventListener('mousedown', function (ev) {
  var m = $('#menuCel');
  if (m && !m.hidden && !ev.target.closest('#menuCel')) cerrarMenu();
}, true);
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape') cerrarMenu();
});
window.addEventListener('scroll', cerrarMenu, true);
window.addEventListener('resize', cerrarMenu);

// ---------- los gestos ----------
$('#malla').addEventListener('mousedown', function (ev) {
  if (!esPlanilla()) return;
  // La × hace lo suyo y no toca la marca: quitar un turno no es marcarlo.
  if (ev.target.dataset && (ev.target.dataset.quitar || ev.target.dataset.agregar)) return;
  var td = ev.target.closest && ev.target.closest('td.cel');
  if (!td) return;
  var k = claveCel(td);
  /* El ratón también mueve el foco: si aprietas una casilla y después usas las
     flechas, tienen que seguir DESDE AHÍ. Sin esta línea el teclado continuaba
     desde la última casilla que habían tocado las flechas, que es un sitio que
     la persona ya no tiene en la cabeza. */
  SEL.foco = k;

  // Con Mayús se extiende desde donde estaba; sin nada, se empieza de cero.
  if (ev.shiftKey && SEL.ancla) { marcarRango(SEL.ancla, k); return; }

  /* LO MARCADO SIGUE AL GESTO. El clic sobre un turno marca ESE turno —el
     mismo que se abre—; el clic sobre el fondo de la casilla marca la casilla
     entera. Arrastrar sigue marcando casillas completas, porque `marcarRango`
     reemplaza la selección por claves de casilla.

     Ctrl/Cmd+clic SUMA y RESTA, sobre turnos o sobre casillas, que es lo que
     hace Skello (verificado en su manual el 11-10). Ahí no se arrastra: quien
     está acumulando no quiere además pintar un rango. */
  var blq = ev.target.closest && ev.target.closest('.blq');
  var idTurno = blq && blq.dataset ? blq.dataset.asigid : null;
  var ctrl = ev.ctrlKey || ev.metaKey;

  if (ctrl) {
    var kc = idTurno ? claveTurno(idTurno) : k;
    var i = SEL.claves.indexOf(kc);
    if (i >= 0) SEL.claves.splice(i, 1); else SEL.claves.push(kc);
    SEL.ancla = k;
    SEL.pintando = false;
    /* Y este clic NO abre la ficha. Sin esto, Ctrl+clic marcaba el turno y
       además te abría el diálogo encima de lo que estabas acumulando. */
    SEL.ctrlClic = true;
    pintarSeleccion();
    return;
  }

  if (idTurno) {
    SEL.ancla = k; SEL.claves = [claveTurno(idTurno)];
    SEL.pintando = true;
    pintarSeleccion();
    return;
  }

  SEL.ancla = k; SEL.claves = [k];
  /* SE ARRASTRA DESDE DONDE SEA, incluso desde encima de un turno.

     Aquí decía `SEL.pintando = !ev.target.closest('.blq')` — arrastrar solo
     desde el fondo de la casilla. Lo copié del proyecto anterior, donde tenía
     una razón buena: allá arrastrar un bloque MOVÍA el turno, y pintar un
     rango le habría robado el gesto.

     En este producto **un turno no se arrastra**: ese gesto está libre. La
     regla no protegía nada y prohibía justo lo natural — pasar el dedo por
     encima de la fila de turnos, que es precisamente la fila que uno quiere
     copiar. Pedro lo probó el 11-10 y dijo «no sirve arrastrar»; medido
     después: desde el bloque marcaba 1 casilla, desde el fondo 2.

     Lo que se hereda de otro proyecto son las decisiones de SIGNIFICADO. Las
     que esquivan un choque entre gestos no, porque los gestos son otros. */
  SEL.pintando = true;
  pintarSeleccion();
});
$('#malla').addEventListener('mouseover', function (ev) {
  if (!SEL.pintando || !SEL.ancla) return;
  var td = ev.target.closest && ev.target.closest('td.cel');
  if (td && claveCel(td) !== SEL.ancla) {
    SEL.arrastro = true; marcarRango(SEL.ancla, claveCel(td));
  }
});
document.addEventListener('mouseup', function () {
  /* Si de verdad hubo arrastre, el clic que viene detrás no abre nada.

     Sin esto, soltar el ratón sobre otro turno podía terminar abriendo su
     ficha encima de la selección recién hecha: la persona marcó un rango y se
     encontró con un diálogo. Se apaga en el siguiente turno del reloj, cuando
     ese clic ya pasó. */
  if (SEL.arrastro || SEL.ctrlClic) {
    SEL.tragarClic = true;
    setTimeout(function () { SEL.tragarClic = false; }, 0);
  }
  SEL.pintando = false; SEL.arrastro = false; SEL.ctrlClic = false;
});

/* LAS TECLAS NO SE ROBAN CUANDO ALGUIEN ESTÁ ESCRIBIENDO. Sin esta guarda,
   Ctrl+C dentro de un campo de texto dejaría de copiar el texto —que es lo
   que la persona quiso— para copiar casillas de la malla. */
function escribiendo(ev) {
  var e = ev.target;
  if (!e || !e.tagName) return false;
  var t = e.tagName.toLowerCase();
  return t === 'input' || t === 'textarea' || t === 'select' || e.isContentEditable
      || !!(e.closest && e.closest('dialog[open]'));
}
/* ====================================================================
   MOVERSE CON EL TECLADO — flechas y Mayús+flechas
   ====================================================================
   Pedro, 13-10 (msg 6221): *«lo más importante es que eso se pueda marcar
   ennegreciendo, o con la función shift+clic o shift+flechas, como en cualquier
   planilla»*. De las tres, dos ya estaban: arrastrar y Mayús+clic. **Las
   flechas no hacían nada**, ni solas.

   DOS EXTREMOS, NO UNO. Una planilla tiene el ANCLA —donde empezó lo marcado,
   que no se mueve— y el FOCO —el extremo que viaja—. Hasta aquí solo existía
   `SEL.ancla`, que hacía los dos papeles porque Mayús+clic traía el otro
   extremo en el propio clic. Con el teclado hay que recordarlo.

   Y NO HACE FALTA UN ESTILO NUEVO: la casilla activa ya se dibuja, es la clase
   `.ancla`. Conviene que siga siendo así: pintar un recuadro en una casilla NO
   marcada ya le molestó en la v75 —«igual ennegrece la casilla completa»—, y
   aquí el foco siempre cae dentro de lo marcado. */
function focoDePartida(g) {
  if (SEL.foco  && g.mapa[SEL.foco])  return SEL.foco;
  if (SEL.ancla && g.mapa[SEL.ancla]) return SEL.ancla;
  return g.filas[0] && g.filas[0][0] ? claveCel(g.filas[0][0]) : null;
}

function moverFoco(df, dc, extender) {
  var g = rejilla(); if (!g) return false;
  var k = focoDePartida(g); if (!k) return false;
  var p = g.mapa[k]; if (!p) return false;

  // Se topa en los bordes en vez de dar la vuelta: aparecer al otro lado de la
  // semana cuando querías salir por la derecha es de las cosas que hacen soltar
  // el teclado y volver al ratón.
  var f = Math.max(0, Math.min(g.filas.length - 1, p.f + df));
  var c = Math.max(0, Math.min((g.filas[f] || []).length - 1, p.c + dc));
  var td = g.filas[f] && g.filas[f][c]; if (!td) return false;

  var nk = claveCel(td);
  SEL.foco = nk;
  if (extender && SEL.ancla && g.mapa[SEL.ancla]) {
    marcarRango(SEL.ancla, nk);
  } else {
    SEL.ancla = nk; SEL.claves = [nk]; pintarSeleccion();
  }
  /* Que la casilla se vea. Sin esto, con el mes o una semana ancha el foco se
     va fuera de la pantalla y parece que las flechas no hacen nada. */
  if (td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

var FLECHAS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

document.addEventListener('keydown', function (ev) {
  if (escribiendo(ev)) return;
  if (ev.key === 'Escape' && SEL.claves.length) { limpiarSeleccion(); return; }

  /* Las flechas van ANTES del guardia de «hay algo marcado»: con la pantalla
     recién abierta no hay nada marcado, y es justo cuando hace falta poder
     empezar a moverse. */
  if (FLECHAS[ev.key] && esPlanilla() && S.vista === 'semana') {
    cerrarMenu();
    if (moverFoco(FLECHAS[ev.key][0], FLECHAS[ev.key][1], ev.shiftKey)) {
      ev.preventDefault();   // si no, la página entera se desplaza
      return;
    }
  }

  if (!esPlanilla() || !SEL.claves.length) return;
  var ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && (ev.key === 'c' || ev.key === 'C')) { ev.preventDefault(); copiarSeleccion(false); }
  else if (ctrl && (ev.key === 'x' || ev.key === 'X')) { ev.preventDefault(); copiarSeleccion(true); }
  else if (ctrl && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); pegarSeleccion(); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); borrarSeleccion(false); }
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
  var esTrab = tipo === 'trabajador' && !!dato;
  $('#fSalida').hidden = !(esTrab && dato.activo !== false);
  $('#fVuelve').hidden = !(esTrab && dato.activo === false);
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

/* QUIEN SE VA NO SE BORRA: se le pone la fecha en que dejo de trabajar.

   Borrarlo se llevaria sus turnos pasados por delante, que es justo lo que
   hace falta el dia que reclama su ultima semana. Y la FECHA se pregunta en
   vez de suponer hoy: casi siempre esto se marca unos dias despues, y esa
   fecha es la que manda en la liquidacion. Se propone hoy para que el caso
   corriente sea apretar Enter. */
$('#fSalida').addEventListener('click', function () {
  var d = ficha && ficha.dato; if (!d) return;
  var cuando = prompt('¿Cuál fue su último día de trabajo?\n\n'
    + 'Sus turnos pasados se quedan tal cual. Deja de aparecer al repartir.',
    hoyTexto());
  if (cuando === null) return;
  cuando = (cuando || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cuando))
    return aviso('#fMsg', 'La fecha va como 2026-10-11.', 'bad');
  aviso('#fMsg', 'Guardando…');
  // El orden importa: primero la fecha no se puede poner con la persona
  // activa —lo impide el candado de la base—, así que van juntas.
  DATOS.trabajadores.guardar(d.id, { activo: false, fecha_salida: cuando })
    .then(function () {
      DATOS.anotar(S.yo.empresa_id, S.yo.id, 'trabajador', d.id, 'editar',
                   { activo: true }, { activo: false, fecha_salida: cuando });
      $('#dlgFicha').close(); return cargarTodo();
    }).catch(function (e) { aviso('#fMsg', e.message, 'bad'); });
});

$('#fVuelve').addEventListener('click', function () {
  var d = ficha && ficha.dato; if (!d) return;
  aviso('#fMsg', 'Guardando…');
  // Vuelve a estar activa y se le quita la fecha: las dos cosas, o el candado
  // de la base lo impide — y con razón, porque decirían cosas distintas.
  DATOS.trabajadores.guardar(d.id, { activo: true, fecha_salida: null })
    .then(function () {
      DATOS.anotar(S.yo.empresa_id, S.yo.id, 'trabajador', d.id, 'editar',
                   { activo: false }, { activo: true });
      $('#dlgFicha').close(); return cargarTodo();
    }).catch(function (e) { aviso('#fMsg', e.message, 'bad'); });
});
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
  $('#listaTrabajadores').innerHTML = activos().length
    ? activos().map(function (p) {
        var cs = (p.trabajador_cargos || []).map(function (x) { return nombreCargo(x.cargo_id); });
        return '<div class="item" data-tipo="trabajador" data-id="' + p.id + '"><b>' + esc(p.nombre) + '</b>'
             + '<span class="sub">' + (cs.length ? esc(cs.join(' · ')) : 'sin cargos') + '</span></div>';
      }).join('')
    : '<p class="vacio">Todavía no hay nadie. Agrega a tu gente.</p>';

  /* LOS QUE YA NO TRABAJAN AQUI, aparte y al final.

     Tienen que estar en alguna parte: si no, marcar a alguien como ido seria
     un camino de ida —no habria donde encontrarlo para corregir la fecha o
     para decir que volvio—. Pero van abajo y apagados, porque la lista de
     arriba es la que se usa todos los dias. */
  var idos = S.trabajadores.filter(function (p) { return p.activo === false; });
  var caja = $('#listaIdos');
  if (caja) {
    caja.hidden = !idos.length;
    caja.innerHTML = !idos.length ? '' :
      '<h3 class="idos-tit">Ya no trabajan aquí <span>(' + idos.length + ')</span></h3>'
      + idos.map(function (p) {
          return '<div class="item ido" data-tipo="trabajador" data-id="' + p.id + '">'
               + '<b>' + esc(p.nombre) + '</b><span class="sub">'
               + (p.fecha_salida ? 'hasta el ' + diaMes(p.fecha_salida) : 'sin fecha')
               + ' · sus turnos pasados siguen ahí</span></div>';
        }).join('');
  }

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
                 + '<span class="sub">' + rangoHtml(h.hora_inicio, h.hora_fin) + '</span>'
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
                   + '<span class="sub">' + rangoHtml(h.hora_inicio, h.hora_fin) + '</span>'
                   + '<span class="espacio"></span>'
                   + '<button class="plano" data-abrirt="' + h.id + '">Darle local</button>'
                   + '<button class="plano" data-borrart="' + h.id + '">Borrar</button></div>';
            }).join('')
          + '</div></div>'
        : '');
}

['#listaTrabajadores','#listaIdos','#listaCargos'].forEach(function (sel) {
  $(sel).addEventListener('click', function (ev) {
    var it = ev.target.closest('.item'); if (!it) return;
    var listas = { trabajador:S.trabajadores, cargo:S.cargos };
    var dato = listas[it.dataset.tipo].filter(function (x) { return x.id === it.dataset.id; })[0];
    abrirFicha(it.dataset.tipo, dato);
  });
});

// ====================================================================
// PLANTILLAS — guardar una semana como modelo y volver a aplicarla
//
// Las tres decisiones se cerraron con Pedro en el chat:
//   1. La plantilla guarda la forma Y la gente. Al aplicar se elige si se
//      pegan las personas. («Igual tiene sentido que deje a la misma gente»:
//      en un local con equipo estable la semana se repite con la misma gente,
//      y repartir todo de nuevo cada semana es el trabajo que esto ahorra.)
//   2. Se aplica a varias semanas.
//   3. Si la semana destino ya tiene cosas SE PREGUNTA, pero solo entonces y
//      no como un paso más del formulario. Verificado: es lo que hace Skello.
//
// La plantilla guarda `dow` y no fechas: una semana SIN fecha es lo que
// permite aplicarla a cualquier otra.
// ====================================================================
var S_PL = { lista: [], hay: false };

function diaDeSemana(fecha) {
  // 0 = lunes, igual que en el resto del sistema.
  var p = fecha.split('-').map(Number);
  return (new Date(p[0], p[1] - 1, p[2]).getDay() + 6) % 7;
}

/* Lo que hay en la semana que se está mirando, convertido a líneas de modelo.
   Se queda SOLO con lo de esta sucursal: una plantilla de un local no tiene
   por qué arrastrar los turnos de otro. */
function lineasDeLaSemana() {
  var dias = [];
  for (var i = 0; i < 7; i++) dias.push(masDias(S.lunes, i));
  var dentro = function (f) { return dias.indexOf(f) >= 0; };
  var lineas = [];
  S.necesidades.forEach(function (n) {
    if (!dentro(n.fecha)) return;
    lineas.push({ tipo: 'necesidad', dow: diaDeSemana(n.fecha), cargo_id: n.cargo_id,
                  hora_inicio: n.hora_inicio, hora_fin: n.hora_fin,
                  personas_requeridas: n.personas_requeridas });
  });
  S.asignaciones.forEach(function (a) {
    if (!dentro(a.fecha)) return;
    lineas.push({ tipo: 'turno', dow: diaDeSemana(a.fecha), cargo_id: a.cargo_id,
                  hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
                  trabajador_id: a.trabajador_id || null });
  });
  return lineas;
}

function guardarModelo() {
  var lineas = lineasDeLaSemana();
  if (!lineas.length) return alert('Esta semana está vacía: no hay nada que guardar.');
  var nom = prompt('¿Cómo se llama este modelo?', 'Semana tipo');
  if (!nom || !nom.trim()) return;
  DATOS.plantillas.crear(S.yo.empresa_id, { nombre: nom.trim(), sucursal_id: S.sucursal })
    .then(function (pl) {
      return DATOS.plantillas.ponerLineas(S.yo.empresa_id, pl.id, lineas).then(function () {
        DATOS.anotar(S.yo.empresa_id, S.yo.id, 'plantilla', pl.id, 'crear', null,
                     { nombre: pl.nombre, lineas: lineas.length });
        avisoPlan('Guardado como <b>' + esc(pl.nombre) + '</b> — '
                  + lineas.length + ' líneas.');
        return cargarPlantillas();
      });
    })
    .catch(function (e) { alert('No se pudo guardar: ' + e.message); });
}

function cargarPlantillas() {
  if (!DATOS.plantillas) return Promise.resolve();
  return DATOS.plantillas.hay().then(function (hay) {
    S_PL.hay = hay;
    var b1 = $('#btnGuardarModelo'), b2 = $('#btnAplicarModelo');
    if (b1) b1.hidden = !hay;
    if (b2) b2.hidden = !hay;
    if (!hay) return;
    return DATOS.plantillas.listar().then(function (r) { S_PL.lista = r || []; });
  });
}

/* APLICAR. Devuelve lo que SE VA A CREAR sin crear nada todavía: así se puede
   contar, avisar del choque y recién entonces escribir. Calcular y escribir en
   el mismo paso es lo que hace imposible preguntar antes. */
function planDeAplicar(lineas, lunes, traer) {
  var necs = [], asigs = [];
  lineas.forEach(function (l) {
    var fecha = masDias(lunes, l.dow);
    if (l.tipo === 'necesidad') {
      if (traer === 'solo-turnos') return;
      necs.push({ empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal, fecha: fecha,
                  cargo_id: l.cargo_id, hora_inicio: l.hora_inicio, hora_fin: l.hora_fin,
                  personas_requeridas: l.personas_requeridas || 1 });
    } else {
      if (traer === 'solo-necesidades') return;
      // Si se pidió «con la gente» pero esa persona ya no está, el turno NO se
      // pierde: entra sin dueño y se cuenta aparte para poder decirlo.
      var sigue = l.trabajador_id
        && S.trabajadores.some(function (t) { return t.id === l.trabajador_id; });
      asigs.push({ empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal, fecha: fecha,
                   cargo_id: l.cargo_id, hora_inicio: l.hora_inicio, hora_fin: l.hora_fin,
                   trabajador_id: (traer === 'con-gente' && sigue) ? l.trabajador_id : null,
                   origen: 'plantilla', necesidad_id: null,
                   __perdida: traer === 'con-gente' && l.trabajador_id && !sigue });
    }
  });
  return { necs: necs, asigs: asigs };
}

function abrirAplicar() {
  if (!S_PL.lista.length) {
    return alert('Todavía no has guardado ningún modelo.\n\n'
      + 'Arma una semana como te guste y aprieta «Guardar como modelo».');
  }
  $('#plModelo').innerHTML = S_PL.lista.map(function (p) {
    return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>';
  }).join('');
  // Las semanas se ofrecen desde la que se está mirando, hacia adelante: nadie
  // aplica una plantilla al pasado.
  $('#plSemanas').innerHTML = [0, 1, 2, 3].map(function (i) {
    var l = masDias(S.lunes, i * 7);
    return '<label class="op"><input type="checkbox" value="' + l + '"'
         + (i === 0 ? ' checked' : '') + '> Semana del <b>' + diaMes(l) + '</b></label>';
  }).join('');
  aviso('#plMsg', '');
  $('#dlgPlantilla').showModal();
}

$('#plAplicar').addEventListener('click', function () {
  var pid = $('#plModelo').value;
  var traer = ($$('[name="plTraer"]').filter(function (r) { return r.checked; })[0] || {}).value
            || 'con-gente';
  var semanas = $$('#plSemanas input:checked').map(function (c) { return c.value; });
  if (!pid || !semanas.length) return aviso('#plMsg', 'Elige al menos una semana.', 'bad');

  aviso('#plMsg', 'Mirando…');
  DATOS.plantillas.lineas(pid).then(function (lineas) {
    if (!lineas.length) return aviso('#plMsg', 'Ese modelo está vacío.', 'bad');

    /* EL CHOQUE SE MIRA ANTES DE ESCRIBIR, y solo se pregunta si lo hay.
       Es lo que hace Skello (verificado en su manual) y resuelve la objeción
       de Pedro: no estorba cuando la semana está vacía, que es casi siempre.

       SE LE PREGUNTA A LA BASE, no a `S.asignaciones`. La primera versión
       miraba la memoria — y la memoria solo tiene LA SEMANA QUE ESTÁS VIENDO,
       no la semana destino. Resultado: nunca encontraba choque y duplicaba en
       silencio. Lo cazó la prueba de aplicar dos veces seguidas: quedaron 10
       turnos donde debían quedar 5 y un aviso. */
    var mirarSemana = function (l) {
      var hasta = masDias(l, 6);
      return Promise.all([
        DATOS.asignaciones.listar(S.sucursal, l, hasta),
        DATOS.necesidades.listar(S.sucursal, l, hasta),
      ]).then(function (r) {
        return ((r[0] || []).length + (r[1] || []).length) ? l : null;
      });
    };

    var seguir = function () {
      var todas = { necs: [], asigs: [], perdidas: 0 };
      semanas.forEach(function (l) {
        var p = planDeAplicar(lineas, l, traer);
        todas.necs = todas.necs.concat(p.necs);
        todas.asigs = todas.asigs.concat(p.asigs);
        todas.perdidas += p.asigs.filter(function (a) { return a.__perdida; }).length;
      });
      todas.asigs.forEach(function (a) { delete a.__perdida; });
      aviso('#plMsg', 'Aplicando…');
      // Nada de llamar con una lista vacía: no se pide a la base que no haga
      // nada, se simplemente no se le pide.
      return Promise.resolve()
        .then(function () { return todas.necs.length
          ? DATOS.necesidades.crear(todas.necs) : null; })
        .then(function () { return todas.asigs.length
          ? DATOS.asignaciones.crear(todas.asigs) : null; })
        .then(function () {
          DATOS.anotar(S.yo.empresa_id, S.yo.id, 'plantilla', pid, 'aplicar', null,
            { semanas: semanas.length, necesidades: todas.necs.length,
              turnos: todas.asigs.length });
          $('#dlgPlantilla').close();
          avisoPlan('Modelo aplicado: <b>' + todas.necs.length + '</b> necesidades y <b>'
            + todas.asigs.length + '</b> turnos en <b>' + semanas.length + '</b> '
            + (semanas.length === 1 ? 'semana' : 'semanas') + '.'
            + (todas.perdidas ? ' <b>' + todas.perdidas + '</b> quedaron sin asignar porque '
               + 'esa persona ya no está.' : ''));
          return recargarSemana();
        })
        .catch(function (e) { aviso('#plMsg', 'No se pudo: ' + e.message, 'bad'); });
    };

    return Promise.all(semanas.map(mirarSemana)).then(function (r) {
      var ocupadas = r.filter(Boolean);
      if (!ocupadas.length) return seguir();
      // Hay choque: se dice CUÁNTAS semanas y se deja decidir. No se borra
      // nada nunca — lo que entra se suma, y eso se dice con todas sus letras.
      var ok = confirm(ocupadas.length === 1
        ? 'La semana del ' + diaMes(ocupadas[0]) + ' ya tiene cosas puestas.\n\n'
          + 'Lo del modelo se SUMA a lo que ya hay: no se borra nada, pero '
          + 'pueden quedar turnos repetidos.\n\n¿Sigo?'
        : ocupadas.length + ' de las semanas elegidas ya tienen cosas puestas.\n\n'
          + 'Lo del modelo se SUMA a lo que ya hay: no se borra nada, pero '
          + 'pueden quedar turnos repetidos.\n\n¿Sigo?');
      if (ok) return seguir();
      aviso('#plMsg', '');
    });
  }).catch(function (e) { aviso('#plMsg', 'No se pudo leer el modelo: ' + e.message, 'bad'); });
});

$('#plCancelar').addEventListener('click', function () { $('#dlgPlantilla').close(); });
$('#btnGuardarModelo').addEventListener('click', guardarModelo);
$('#btnAplicarModelo').addEventListener('click', abrirAplicar);

// ====================================================================
// ACTIVIDAD — la bitácora a la vista  (opción A, Pedro msg 5353)
//
// Los datos se graban desde el primer día: `eventos` guarda `antes` y
// `despues` completos. Lo que faltaba era PINTARLOS — y lo que decide si
// sirve o no es esto de aquí abajo: que cada línea diga QUÉ cambió, en
// castellano, en vez de «editó una asignación».
//
// Un registro que hay que descifrar no se lee, y entonces da igual tenerlo.
// ====================================================================
var S_ACT = { eventos: [], filtro: 'todo', pagina: 0 };
var ACT_TANDA = 50;

/* Quién lo hizo, SIEMPRE EN TERCERA PERSONA.

   La primera versión decía «Tú» cuando eras tú, y salía «Tú publicó», «Tú
   cambió»: el sujeto en segunda y el verbo en tercera. Para arreglarlo con un
   «Tú publicaste» harían falta DOS juegos de frases, uno por persona
   gramatical, y cada frase nueva habría que escribirla dos veces — el día que
   se olvide una, vuelve el error.

   Con el nombre siempre en tercera, hay un solo juego de frases. Que seas tú
   se marca aparte, con un «(tú)» detrás del nombre.

   Si no se puede poner nombre —un dueño que no es trabajador, o alguien dado
   de baja— se usa lo que haya antes del arroba del correo, y si ni eso,
   «Alguien». Nunca un identificador: no le dice nada a nadie. */
function quienEvento(uid) {
  if (!uid) return 'Alguien';
  var t = S.trabajadores.filter(function (p) { return p.usuario_id === uid; })[0];
  var yo = S.yo && uid === S.yo.id;
  var nom = t ? t.nombre
          : (yo && S.yo.email ? String(S.yo.email).split('@')[0] : null);
  if (!nom) return 'Alguien';
  return nom + (yo ? ' (tú)' : '');
}

function nombreDeTrab(id) { return id ? nombreTrab(id) : null; }

function cuandoTexto(iso) {
  var d = new Date(iso), hoy = new Date();
  var hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  var mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia ? hh
    : (String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
       + ' ' + hh);
}

function rangoDe(o) {
  return o && o.hora_inicio ? rangoTxt(o.hora_inicio, o.hora_fin) : '';
}

/* De un evento a una frase. Devuelve {que, detalle, tipo}.

   `antes` y `despues` son la fila entera, así que se puede decir exactamente
   qué se movió sin volver a consultar nada — y sirve igual para filas que ya
   se borraron, que es justo cuando más falta hace. */
function frasearEvento(e) {
  var a = e.antes || null, d = e.despues || null, x = d || a || {};
  var cargo = x.cargo_id ? esc(nombreCargo(x.cargo_id)) : '';
  var dia = x.fecha ? nombreDia(x.fecha) + ' ' + diaMes(x.fecha) : '';

  if (e.entidad === 'asignacion') {
    var quienA = a ? nombreDeTrab(a.trabajador_id) : null;
    var quienD = d ? nombreDeTrab(d.trabajador_id) : null;
    if (e.accion === 'crear') {
      return { tipo: 'crear',
        que: quienD ? 'asignó a <b>' + esc(quienD) + '</b> en <b>' + cargo + '</b>'
                    : 'dejó un turno pendiente en <b>' + cargo + '</b>',
        detalle: (dia ? dia + ' · ' : '') + rangoDe(d) };
    }
    if (e.accion === 'borrar') {
      return { tipo: 'borrar',
        que: 'quitó el turno de <b>' + esc(quienA || 'nadie') + '</b> en <b>' + cargo + '</b>',
        detalle: (dia ? dia + ' · ' : '') + rangoDe(a) };
    }
    // editar: se dice lo que DE VERDAD cambió, no «editó»
    if ((a && a.trabajador_id) !== (d && d.trabajador_id)) {
      if (!quienA) return { tipo: 'crear',
        que: 'asignó a <b>' + esc(quienD) + '</b> un turno que estaba pendiente',
        detalle: cargo + (dia ? ' · ' + dia : '') + ' · ' + rangoDe(d) };
      if (!quienD) return { tipo: 'mover',
        que: 'dejó pendiente el turno de <b>' + esc(quienA) + '</b>',
        detalle: cargo + ' · ' + rangoDe(d) };
      return { tipo: 'mover',
        que: 'pasó el turno de <b>' + esc(quienA) + '</b> a <b>' + esc(quienD) + '</b>',
        detalle: cargo + ' · ' + rangoDe(d) };
    }
    if (a && d && (a.hora_inicio !== d.hora_inicio || a.hora_fin !== d.hora_fin)) {
      var dur = function (o) { return horasDe(hhmm(o.hora_inicio), hhmm(o.hora_fin)); };
      var mismaDur = Math.abs(dur(a) - dur(d)) < 0.01;
      return { tipo: 'mover',
        que: (mismaDur ? 'movió' : 'cambió las horas del') + ' turno de <b>'
             + esc(quienD || 'nadie') + '</b> en <b>' + cargo + '</b>',
        detalle: rangoDe(a) + ' → ' + rangoDe(d) };
    }
    return { tipo: 'mover', que: 'cambió un turno en <b>' + cargo + '</b>',
             detalle: (dia ? dia + ' · ' : '') + rangoDe(d) };
  }

  if (e.entidad === 'necesidad') {
    if (e.accion === 'crear') return { tipo: 'crear',
      que: 'agregó: hacen falta <b>' + (d.personas_requeridas || '?') + '</b> en <b>' + cargo + '</b>',
      detalle: (dia ? dia + ' · ' : '') + rangoDe(d) };
    if (e.accion === 'borrar') return { tipo: 'borrar',
      que: 'borró lo que hacía falta en <b>' + cargo + '</b>',
      detalle: (dia ? dia + ' · ' : '') + rangoDe(a) };
    if (a && d && a.personas_requeridas !== d.personas_requeridas) return { tipo: 'mover',
      que: 'en <b>' + cargo + '</b> ahora hacen falta <b>' + d.personas_requeridas + '</b>',
      detalle: 'antes ' + a.personas_requeridas + ' · ' + rangoDe(d) };
    return { tipo: 'mover',
      que: 'cambió las horas de lo que hace falta en <b>' + cargo + '</b>',
      detalle: (a ? rangoDe(a) + ' → ' : '') + rangoDe(d) };
  }

  if (e.entidad === 'turno') {
    /* Los campos son los que GRABA la app: `nuevas`, `cambiados` y `semana`.
       Los escribí primero esperando un `cuantos` que me había inventado en la
       demo — cuarta vez en el día que el dato del doble no era el de verdad, y
       esta vez la diferencia la creé yo. Se mira el que graba, no el cómodo. */
    var nv = d && d.nuevas, cb = d && d.cambiados;
    var trozos = [];
    if (nv) trozos.push(nv + (nv === 1 ? ' turno nuevo' : ' turnos nuevos'));
    if (cb) trozos.push(cb + (cb === 1 ? ' cambiado' : ' cambiados'));
    var sem = d && d.semana ? 'semana del ' + diaMes(d.semana) : '';
    return { tipo: 'publicar', que: 'publicó la planificación',
             detalle: [trozos.join(' · '), sem].filter(Boolean).join(' — ') };
  }

  var comoSeLlama = { trabajador: 'un trabajador', cargo: 'un cargo',
                      sucursal: 'un local', horario: 'un tramo' };
  var cosa = comoSeLlama[e.entidad] || e.entidad;
  var nom = (d && d.nombre) || (a && a.nombre) || '';
  return { tipo: e.accion === 'borrar' ? 'borrar' : (e.accion === 'crear' ? 'crear' : 'mover'),
           que: (e.accion === 'crear' ? 'creó ' : e.accion === 'borrar' ? 'borró ' : 'cambió ')
                + cosa + (nom ? ' <b>' + esc(nom) + '</b>' : ''), detalle: '' };
}

function pintarActividad() {
  var caja = $('#listaActividad'); if (!caja) return;
  var lista = S_ACT.eventos.filter(function (e) {
    return S_ACT.filtro === 'todo' || e.entidad === S_ACT.filtro;
  });
  if (!lista.length) {
    caja.innerHTML = '<p class="vacio">' + (S_ACT.eventos.length
      ? 'Nada de este tipo todavía.'
      : 'Todavía no hay movimientos. Aquí va quedando todo lo que se hace.') + '</p>';
    return;
  }
  caja.innerHTML = lista.map(function (e) {
    var f = frasearEvento(e);
    return '<div class="ev ' + f.tipo + '">'
      + '<span class="pt"></span>'
      + '<div class="txt"><div class="q"><b>' + esc(quienEvento(e.usuario_id)) + '</b> '
      + f.que + '</div>'
      + (f.detalle ? '<div class="d">' + f.detalle + '</div>' : '') + '</div>'
      + '<span class="h">' + cuandoTexto(e.cuando) + '</span></div>';
  }).join('');
}

function cargarActividad(mas) {
  if (!DATOS.eventos) return;
  if (!mas) { S_ACT.pagina = 0; S_ACT.eventos = []; }
  return DATOS.eventos.listar(S_ACT.pagina * ACT_TANDA, ACT_TANDA).then(function (r) {
    S_ACT.eventos = S_ACT.eventos.concat(r || []);
    S_ACT.pagina += 1;
    var b = $('#btnMasActividad');
    if (b) b.hidden = !r || r.length < ACT_TANDA;
    pintarActividad();
  }).catch(function (e) {
    $('#listaActividad').innerHTML = '<p class="vacio">No pude leer la bitácora: '
      + esc(e.message) + '</p>';
  });
}

$('#filActividad').addEventListener('click', function (ev) {
  var b = ev.target.closest('.chip'); if (!b) return;
  $$('#filActividad .chip').forEach(function (c) {
    c.setAttribute('aria-selected', String(c === b));
  });
  S_ACT.filtro = b.dataset.f;
  pintarActividad();
});
$('#btnMasActividad').addEventListener('click', function () { cargarActividad(true); });

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
               + '<span class="sub">' + rangoHtml(t.hora_inicio, t.hora_fin)
               + ' · ' + esc(nombreCargo(t.cargo_id)) + '</span></div>';
        }).join('')
      : '<p class="vacio">No tienes turnos publicados en las próximas semanas.</p>';
  }).catch(function (e) { caja.innerHTML = '<p class="vacio">' + esc(e.message) + '</p>'; });
}

// ====================================================================
// AUSENCIAS
//
// UN dialogo para los 17 tipos. Lo que cambia entre una licencia medica y unas
// vacaciones NO esta en el codigo: esta en la fila del tipo. Esa es toda la
// idea del catalogo, y si alguna vez aparece aqui un `if (nombre === 'Licencia
// medica')`, el catalogo dejo de mandar y hay que volver atras.
// ====================================================================
var ausActual = null;
// Que tipo estaba elegido la vez anterior, para saber si el tipo CAMBIO y hay
// que volver la unidad a la suya.
var unidadPrevia = null;

function abrirAusencia(a, fecha, trabajadorId) {
  if (!S.hayAusencias)
    return alert('Falta pegar la migración de ausencias en la base.');
  if (!S.tiposAusencia.length)
    return alert('No hay tipos de ausencia cargados todavía.');
  if (!activos().length)
    return alert('Primero crea a alguien en Equipo.');

  ausActual = a || null;
  /* «Ausencia / permiso», como lo pidio Pedro (msg 5512).

     Nadie dice «ausencia» en un local: se dice permiso, licencia, vacaciones o
     falta segun el caso. Las dos palabras juntas son el paraguas que se
     entiende sin explicar, y evita el error de llamarle «permiso» a una
     licencia medica —que nadie concede— o a una falta. */
  $('#usTit').textContent = a ? 'Ausencia / permiso' : 'Registrar una ausencia / permiso';

  $('#usQuien').innerHTML = activos().map(opcion).join('');
  $('#usQuien').value = a ? a.trabajador_id : (trabajadorId || activos()[0].id);

  /* Los tipos salen AGRUPADOS POR TRATO y con el trato escrito en el titulo
     del grupo. No es decoracion: es lo unico que explica, en el momento de
     elegir, por que a este tipo se le puede decir que no y a aquel no. */
  var grupos = [
    ['acuerdo',   'Se acuerda entre los dos'],
    ['aviso',     'Se avisa — no se puede negar'],
    ['documento', 'Llega con documento'],
    ['registro',  'Se registra después'],
  ];
  $('#usTipo').innerHTML = grupos.map(function (g) {
    var ts = S.tiposAusencia.filter(function (t) { return t.trato === g[0]; });
    if (!ts.length) return '';
    return '<optgroup label="' + g[1] + '">' + ts.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.nombre) + '</option>';
    }).join('') + '</optgroup>';
  }).join('');
  $('#usTipo').value = a ? a.tipo_id : S.tiposAusencia[0].id;
  $('#usUnidad').value = (a && a.unidad) || (tipoAusencia($('#usTipo').value) || {}).unidad || 'dia';

  var f = a ? a.desde : (fecha || hoyTexto());
  $('#usDesde').value = f;
  $('#usHasta').value = a ? a.hasta : f;
  $('#usEntra').value = a && a.hora_inicio ? hhmm(a.hora_inicio) : '09:00';
  $('#usSale').value  = a && a.hora_fin    ? hhmm(a.hora_fin)    : '13:00';
  delete $('#usEntra').dataset.tocado;
  delete $('#usSale').dataset.tocado;
  $('#usFolio').value = (a && a.documento_ref) || '';
  $('#usNota').value  = (a && a.nota) || '';
  $('#usAnular').hidden = !a;
  aviso('#usMsg', '');
  pintarFormaAusencia();
  $('#dlgAus').showModal();
}

/* El formulario SE ARMA con la fila del tipo. Aqui se ve en una funcion lo que
   en la base son columnas: `unidad`, `pide_documento`, `pide_nota` y `trato`. */
function pintarFormaAusencia() {
  var t = tipoAusencia($('#usTipo').value);
  if (!t) return;

  /* La unidad sale del tipo, salvo que el tipo deje elegir. Al CAMBIAR de tipo
     el desplegable vuelve a la unidad de ese tipo: si se quedara con lo
     anterior, elegir «medio día» en un permiso y despues cambiar a licencia
     medica dejaria media licencia sin que nadie lo pidiera. */
  var abierto = t.unidad_fija === false;
  $('#usUnidadCaja').hidden = !abierto;
  if (!abierto || unidadPrevia !== t.id) $('#usUnidad').value = t.unidad;
  unidadPrevia = t.id;
  var unidad = abierto ? $('#usUnidad').value : t.unidad;
  var porDia = unidad === 'dia';

  // Medio dia y horas son de UN dia: el disparador de la base lo rechaza, asi
  // que la pantalla ni siquiera ofrece poner un rango. Mejor no poder hacerlo
  // que poder hacerlo y que te lo rechacen al guardar.
  $('#usHastaCaja').hidden = !porDia;
  if (!porDia) $('#usHasta').value = $('#usDesde').value;
  /* EL MEDIO DIA TAMBIEN PIDE LAS HORAS.

     Lo encontro Pedro usandolo de verdad (msg 5536): «¿aca se debe especificar
     si es medio dia de mañana o de tarde?». Tenia razon y era un defecto mio —
     las habia escondido a proposito. Sin las horas, LA MALLA NO SABE si el
     turno de la tarde queda cubierto, que es justo lo que las ausencias vienen
     a arreglar.

     NO se funden «medio dia» y «horas», y la diferencia importa: medio dia es
     CUANTO CORRESPONDE —media jornada, que es lo que dice el art. 66 bis— y las
     horas son CUANDO PASO. Si se juntaran, el dia que haya saldos media jornada
     y «cuatro horas» dejarian de distinguirse, y en un turno de nueve horas no
     es lo mismo.

     Para las horas, obligatorias solo en 'horas'; en medio dia son el detalle
     de cuando. */
  $('#usHorasCaja').hidden = (unidad === 'dia');
  if (unidad === 'medio_dia') sugerirMediaJornada();
  $('#usFolioCaja').hidden = !t.pide_documento;
  $('#usNotaEt').textContent = t.pide_nota ? 'Motivo (obligatorio)' : 'Motivo (opcional)';

  // Lo que la ley dice de este tipo, en el momento de elegirlo. Si el tipo no
  // tiene base legal se dice que es del local: prometer una regla legal que no
  // existe es peor que no decir nada.
  var ley = $('#usLey');
  var txt = '';
  if (t.base_legal) {
    txt = esc(t.base_legal);
    // 'habiles' se guarda sin acento porque es un codigo con un `check`
    // detras; el acento —y el singular— se le ponen aqui, que es donde se lee.
    if (t.dias_legales) txt += ' · <b>' + esc(diasTexto(t.dias_legales, t.dias_base)) + '</b>';
  } else {
    txt = 'No viene de la ley: es un acuerdo o un beneficio del local.';
    // Un tipo del local puede tener su propio numero de dias, y hay que decirlo
    // igual: el que lo escribio lo escribio para que se viera.
    if (t.dias_legales) txt += ' Das <b>' + esc(diasTexto(t.dias_legales, t.dias_base)) + '</b>.';
  }
  if (t.exento_bloqueos) txt += ' · <b>no la detienen los días bloqueados</b>';
  ley.hidden = false;
  ley.innerHTML = txt;

  /* EL BOTON DE RECHAZAR NO EXISTE cuando el trato es 'aviso'.

     No esta desactivado: no esta. Un boton apagado invita a preguntarse como
     se enciende, y aca la respuesta es que no se enciende nunca — rechazar un
     permiso del art. 66 seria ilegal. La base ademas lo impide, asi que un
     boton visible solo serviria para llevarse un error en la cara. */
  $('#usRechazar').hidden = (t.trato !== 'acuerdo');
  $('#usGuardar').textContent = t.trato === 'acuerdo' ? 'Aprobar' : 'Registrar';

  pintarOjoAusencia();
}

/* Las horas del medio dia, ya puestas: se parte el turno de esa persona ese dia
   por la mitad y se ofrece LA PRIMERA MITAD, que es el caso corriente.

   Si no tiene turno ese dia no hay de donde sacarlas, y se dice. Inventar un
   09:00 que no significa nada es peor que dejarlo vacio: el encargado lo daria
   por bueno sin mirar. */
function sugerirMediaJornada() {
  var pid = $('#usQuien').value, f = $('#usDesde').value;
  var hint = $('#usMedioHint');
  var turnos = S.asignaciones.filter(function (a) {
    return a.trabajador_id === pid && a.fecha === f;
  });
  if (!turnos.length) {
    if (hint) { hint.hidden = false;
      hint.innerHTML = 'Esa persona <b>no tiene turno ese día</b>, así que no puedo '
        + 'deducir las horas. Ponlas tú si las sabes.'; }
    return;
  }
  /* Con TURNO PARTIDO —cuatro horas en la mañana y cuatro en la tarde— hay dos
     turnos ese dia. Se parte EL PRIMERO, y el aviso dice cual se uso para que
     se vea y se pueda corregir. Tomar «el que venga primero en la lista» daba
     el de la tarde segun como volvieran de la base: lo pillo la comprobacion,
     que esperaba 09:00 y recibio 17:00. */
  turnos.sort(function (x, y) { return a2h(hhmm(x.hora_inicio)) - a2h(hhmm(y.hora_inicio)); });
  var t = turnos[0];
  var ini = hhmm(t.hora_inicio), fin = hhmm(t.hora_fin);
  var mitad = a2h(ini) + horasDe(ini, fin) / 2;
  var hh = Math.floor(mitad), mm = Math.round((mitad - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  // Al cuarto de hora: «13:07» no es una hora que nadie escriba.
  mm = Math.round(mm / 15) * 15;
  if (mm === 60) { hh += 1; mm = 0; }
  var corte = String(hh % 24).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  // Solo se sugiere si el usuario no escribio nada todavia.
  if (!$('#usEntra').dataset.tocado) {
    $('#usEntra').value = ini;
    $('#usSale').value  = corte;
  }
  if (hint) { hint.hidden = false;
    hint.innerHTML = 'Es la <b>primera mitad</b> de su turno de ' + esc(ini) + '–' + esc(fin)
      + '. Si es la otra mitad, cámbialas por <b>' + esc(corte) + '–' + esc(fin) + '</b>.'; }
}
['#usEntra', '#usSale'].forEach(function (id) {
  $(id).addEventListener('input', function () { this.dataset.tocado = '1'; });
});

/* El aviso de la ausencia: choca con turnos que esa persona ya tiene. AVISA.
   Si los turnos ya estan publicados, se dice — porque entonces ademas hay que
   volver a hablar con la persona, y eso no lo arregla la app. */
function pintarOjoAusencia() {
  var e = $('#usOjo');
  var pid = $('#usQuien').value;
  var d = $('#usDesde').value, h = $('#usHastaCaja').hidden ? d : ($('#usHasta').value || d);
  if (!pid || !d) { e.hidden = true; return; }

  /* El bloqueo se avisa ACA y se impide al guardar. Avisarlo solo al final
     sería dejar que la persona escriba todo para recibir un no. */
  var tipoSel = tipoAusencia($('#usTipo').value);
  var bloq = bloqueoQueChoca(tipoSel, pid, d, h);
  if (bloq) {
    e.hidden = false;
    e.innerHTML = '🔴 Esas fechas están <b>bloqueadas</b>'
      + (bloq.motivo ? ' (' + esc(bloq.motivo) + ')' : '')
      + ': del <b>' + esc(diaMes(bloq.desde)) + '</b> al <b>' + esc(diaMes(bloq.hasta))
      + '</b> no se puede pedir libre. Esta no se va a poder guardar.';
    return;
  }

  var choca = S.asignaciones.filter(function (a) {
    return a.trabajador_id === pid && a.fecha >= d && a.fecha <= h;
  });
  if (!choca.length) { e.hidden = true; return; }

  var publicados = choca.filter(function (a) {
    return S.turnos.some(function (t) {
      return t.asignacion_id === a.id && t.estado === 'publicado';
    });
  }).length;

  e.hidden = false;
  e.innerHTML = '⚠️ Esa persona tiene <b>' + choca.length + '</b> turno'
    + (choca.length === 1 ? '' : 's') + ' en esas fechas'
    + (publicados ? ', y <b>' + publicados + '</b> ya está'
       + (publicados === 1 ? '' : 'n') + ' publicado' + (publicados === 1 ? '' : 's')
       + ' — se quedan ahí, <b>marcados para revisar</b>' : '')
    + '. Se guarda igual.';
}

['#usTipo', '#usUnidad'].forEach(function (id) {
  $(id).addEventListener('change', pintarFormaAusencia);
});
['#usQuien', '#usDesde', '#usHasta'].forEach(function (id) {
  $(id).addEventListener('change', pintarOjoAusencia);
});
$('#usCancelar').addEventListener('click', function () { $('#dlgAus').close(); });

/* El detalle por dia, calculado CON LA MALLA DEL MOMENTO.

   Es la razon de ser de la tabla: dentro de seis meses la malla cambio y esto
   ya no se podria reconstruir. Lo que no se sabe NO SE INVENTA — los feriados
   legales no los tiene la app todavia, asi que un dia sin turno se guarda como
   'no trabajaba', que es lo unico que consta. */
function desgloseAusencia(trabajadorId, desde, hasta, unidad, entra, sale) {
  var filas = [], f = desde, tope = 0;
  while (f <= hasta && tope++ < 400) {
    var turnos = S.asignaciones.filter(function (a) {
      return a.trabajador_id === trabajadorId && a.fecha === f;
    });
    var horas = 0;
    turnos.forEach(function (a) { horas += horasDe(hhmm(a.hora_inicio), hhmm(a.hora_fin)); });
    if (unidad === 'horas' && entra && sale) horas = horasDe(entra, sale);
    else if (unidad === 'medio_dia') horas = horas / 2;

    var trabajaba = turnos.length > 0;
    var cuenta = trabajaba && horas > 0;
    filas.push({
      fecha: f, trabajaba: trabajaba,
      hora_inicio: turnos.length ? hhmm(turnos[0].hora_inicio) : null,
      hora_fin:    turnos.length ? hhmm(turnos[0].hora_fin)    : null,
      horas: Math.round(horas * 100) / 100,
      cuenta: cuenta,
      motivo_no_cuenta: cuenta ? null : 'no trabajaba',
    });
    f = masDias(f, 1);
  }
  return filas;
}

/* LOS TURNOS YA PUBLICADOS QUEDAN MARCADOS, NO BORRADOS.

   Es lo que el dialogo promete al avisar «se quedan ahí, marcados para
   revisar», y durante unas horas fue solo eso: una promesa. Las columnas
   estaban en la base, el aviso estaba en la pantalla, y nadie las rellenaba.
   Una promesa a medias es peor que no hacerla: el encargado confia en que la
   app se acuerda, y no se acordaba.

   POR QUE NO SE BORRAN: el turno publicado es LO QUE SE LE COMUNICO A LA
   PERSONA. Borrarlo deja sin prueba lo que esa persona vio, que es justo lo
   que se discute cuando se discute un sueldo.

   Solo se marcan los PUBLICADOS: un borrador todavia no se le dijo a nadie, y
   para ese la malla ya avisa sola.

   Si falla el marcado NO se cae todo: la ausencia ya quedo guardada, que es lo
   importante. Se avisa por consola y la malla igual pinta el choque. */
function marcarTurnosParaRevisar(ausencia, trabajadorId, desde, hasta) {
  var tocados = S.turnos.filter(function (t) {
    return t.trabajador_id === trabajadorId && t.estado === 'publicado'
        && t.fecha >= desde && t.fecha <= hasta && !t.revisar;
  });
  if (!tocados.length) return Promise.resolve([]);
  return Promise.all(tocados.map(function (t) {
    return DATOS.turnos.guardar(t.id, {
      revisar: true, revisar_motivo: 'ausencia', revisar_ausencia_id: ausencia.id,
    }).then(function (nuevo) {
      DATOS.anotar(S.yo.empresa_id, S.yo.id, 'turno', t.id, 'editar', t, nuevo);
      return nuevo;
    });
  })).catch(function (e) {
    console.warn('no pude marcar los turnos para revisar:', e.message);
    return [];
  });
}

$('#usGuardar').addEventListener('click', function () { guardarAusencia('ok'); });
$('#usRechazar').addEventListener('click', function () { guardarAusencia('rechazada'); });

function guardarAusencia(que) {
  var t = tipoAusencia($('#usTipo').value);
  if (!t) return;
  var pid = $('#usQuien').value;
  var desde = $('#usDesde').value;
  var hasta = $('#usHastaCaja').hidden ? desde : ($('#usHasta').value || desde);
  if (!pid || !desde) return aviso('#usMsg', 'Falta la persona o la fecha.', 'bad');
  if (hasta < desde) return aviso('#usMsg', 'La fecha de término es anterior a la de inicio.', 'bad');
  if (t.pide_nota && !$('#usNota').value.trim())
    return aviso('#usMsg', 'Este tipo necesita que escribas el motivo.', 'bad');

  /* LA UNICA PUERTA CERRADA, y la encendio Pedro. Basta que UN dia del rango
     caiga dentro: partir la solicitud dejaria media ausencia sin revisar. */
  var bloq = bloqueoQueChoca(t, pid, desde, hasta);
  if (bloq) return aviso('#usMsg', 'Del <b>' + esc(diaMes(bloq.desde)) + '</b> al <b>'
    + esc(diaMes(bloq.hasta)) + '</b> las fechas están bloqueadas'
    + (bloq.motivo ? ' (' + esc(bloq.motivo) + ')' : '')
    + ', así que no se puede registrar esto. Quita el bloqueo en Configuración si cambiaste de idea.', 'bad');

  /* El estado sale del TRATO, no de un desplegable.

     Lo que se acuerda se aprueba o se rechaza; lo demas se REGISTRA, porque
     nadie lo aprobo — una licencia la decide el medico. Ofrecer «aprobada»
     para una licencia seria dejar escrito en la base algo que no paso. */
  var estado = que === 'rechazada' ? 'rechazada'
             : (t.trato === 'acuerdo' ? 'aprobada' : 'registrada');
  var resuelta = (estado === 'aprobada' || estado === 'rechazada');

  // Solo se guarda la unidad cuando se ELIGIO una distinta: si fuera siempre,
  // un tipo que cambie de unidad manaña no alcanzaria a las ausencias viejas y
  // nadie sabria si eso fue una eleccion o el valor de entonces.
  var abierto = t.unidad_fija === false;
  var unidad = abierto ? $('#usUnidad').value : t.unidad;
  var d = {
    trabajador_id: pid, tipo_id: t.id, desde: desde, hasta: hasta,
    unidad: (abierto && unidad !== t.unidad) ? unidad : null,
    hora_inicio: unidad === 'dia' ? null : ($('#usEntra').value || null),
    hora_fin:    unidad === 'dia' ? null : ($('#usSale').value  || null),
    estado: estado,
    nota: $('#usNota').value.trim() || null,
    documento_ref: t.pide_documento ? ($('#usFolio').value.trim() || null) : null,
    /* La cifra que rige HOY, copiada a esta ausencia. Si manaña Pedro edita el
       tipo —la ley cambia—, esta ausencia sigue diciendo lo que regia cuando se
       registro. Misma fotografia que `ausencia_dias`. */
    dias_legales_entonces: t.dias_legales || null,
    dias_base_entonces: t.dias_legales ? t.dias_base : null,
    pedida_por: S.yo.id,
    resuelta_por: resuelta ? S.yo.id : null,
    resuelta_en: resuelta ? new Date().toISOString() : null,
  };

  aviso('#usMsg', 'Guardando…');
  var antes = ausActual && JSON.parse(JSON.stringify(ausActual));
  var p = ausActual ? DATOS.ausencias.guardar(ausActual.id, d)
                    : DATOS.ausencias.crear(S.yo.empresa_id, d);
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'ausencia', fila.id,
                 ausActual ? 'editar' : 'crear', antes, fila);
    // El detalle solo tiene sentido cuando la ausencia de verdad ocurre.
    if (estado === 'rechazada') return fila;
    var filas = desgloseAusencia(pid, desde, hasta, unidad,
                                 $('#usEntra').value, $('#usSale').value);
    return DATOS.ausencias.ponerDias(S.yo.empresa_id, fila.id, filas)
      .then(function () { return marcarTurnosParaRevisar(fila, pid, desde, hasta); })
      .then(function () { return fila; });
  }).then(function () {
    $('#dlgAus').close();
    return recargarSemana();
  }).catch(function (e) {
    // Los mensajes del disparador salen en castellano y ya se entienden; los
    // del indice unico, no.
    if (/ausencias_sin_repetir/.test(e.message))
      return aviso('#usMsg', 'Esa persona ya tiene registrada esa misma ausencia ese día.', 'bad');
    aviso('#usMsg', e.message, 'bad');
  });
}

$('#usAnular').addEventListener('click', function () {
  if (!ausActual) return;
  if (!confirm('¿Anular esta ausencia? No se borra: queda en la bitácora.')) return;
  DATOS.ausencias.anular(ausActual.id).then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'ausencia', ausActual.id, 'editar', ausActual, fila);
    $('#dlgAus').close();
    return recargarSemana();
  }).catch(function (e) { aviso('#usMsg', e.message, 'bad'); });
});

// ====================================================================
// EL CATALOGO DE PERMISOS Y AUSENCIAS
//
// Existe por una razon que Pedro dijo con todas sus letras: «la regulacion
// cambia constantemente». Un producto donde haya que llamar al programador para
// subir un permiso de 10 a 20 dias no se puede vender. Con esta pantalla las
// reglas las mantiene el.
//
// LO QUE ESTA PANTALLA NO RESUELVE, y esta dicho para que nadie lo descubra
// tarde: no hay FECHA DE VIGENCIA. Editar la fila cambia el numero tambien
// hacia atras. Hoy no duele porque el numero solo se muestra; el dia que haya
// saldos de vacaciones habra que agregar `vigente_desde` — que es agregar una
// columna, no rehacer esto.
// ====================================================================
var tipoActual = null;
var catalogo = [];

var TRATOS = {
  acuerdo:   'Se acuerda entre los dos',
  aviso:     'Se avisa — no se puede negar',
  documento: 'Llega con documento',
  registro:  'Se registra después',
};
var AYUDA_TRATO = {
  acuerdo:   'Se puede aprobar y rechazar, y aquí sí aplican los días bloqueados.',
  aviso:     'La app <b>no ofrecerá el botón de rechazar</b>: negarlo sería ilegal.',
  documento: 'Llega como hecho y es retroactiva: puede tapar un turno ya publicado.',
  registro:  'Nadie lo pidió, pasó. Se anota después.',
};
var UNIDADES = { dia:'días completos', medio_dia:'medio día', horas:'horas' };

/* «1 días corridos» no lo escribe nadie. Lo vio Pedro llenando un permiso de
   cumpleaños con un dia: el singular hay que decirlo, y la clase tambien
   cambia —un dia HABIL, no un dia habiles—. */
function diasTexto(n, clase) {
  var uno = Number(n) === 1;
  var c = clase === 'habiles' ? (uno ? 'hábil' : 'hábiles')
                              : (uno ? 'corrido' : 'corridos');
  return n + (uno ? ' día ' : ' días ') + c;
}

function cargarCatalogo() {
  if (!S.hayAusencias) return Promise.resolve([]);
  return DATOS.ausencias.tiposTodos().then(function (f) {
    catalogo = f; pintarCatalogo(); return f;
  }).catch(function (e) {
    $('#listaTipos').innerHTML = '<p class="vacio">' + esc(e.message) + '</p>';
  });
}

function pintarCatalogo() {
  $('#ctrlTipos').hidden = !S.hayAusencias;
  $('#hintTipos').hidden = !S.hayAusencias;
  if (!S.hayAusencias) { $('#listaTipos').innerHTML = ''; return; }

  var html = '';
  Object.keys(TRATOS).forEach(function (tr) {
    var ts = catalogo.filter(function (t) { return t.trato === tr; });
    if (!ts.length) return;
    html += '<p class="grupoTipo"><b>' + esc(TRATOS[tr]) + '</b></p>';
    ts.forEach(function (t) {
      // La base legal a la vista, y «del local» cuando no la tiene: decir que
      // algo es ley sin serlo es peor que no decir nada.
      var base = t.base_legal
        ? esc(t.base_legal) + (t.dias_legales ? ' · ' + esc(diasTexto(t.dias_legales, t.dias_base)) : '')
        : 'del local' + (t.dias_legales ? ' · ' + esc(diasTexto(t.dias_legales, t.dias_base)) : '');
      var marcas = [];
      if (t.pide_documento)  marcas.push('documento');
      if (t.pide_nota)       marcas.push('motivo');
      if (t.exento_bloqueos) marcas.push('no la frenan los bloqueos');
      if (!t.con_goce)       marcas.push('sin goce');
      if (t.suma_conteo_mes) marcas.push('suma al conteo');
      html += '<div class="item' + (t.activo ? '' : ' apagado') + '" data-tipoid="' + t.id + '">'
        + '<b>' + esc(t.nombre) + '</b>'
        + (t.de_sistema ? '<span class="sello">del sistema</span>' : '')
        + '<span class="sub">' + esc(UNIDADES[t.unidad] || t.unidad)
        + (t.unidad_fija === false ? ' <i>(se elige)</i>' : '') + ' · ' + base
        + (marcas.length ? ' · ' + esc(marcas.join(' · ')) : '')
        + (t.activo ? '' : ' · <b>desactivado</b>') + '</span></div>';
    });
  });
  $('#listaTipos').innerHTML = html || '<p class="vacio">No hay tipos todavía.</p>';
}

$('#listaTipos').addEventListener('click', function (ev) {
  var it = ev.target.closest('.item'); if (!it) return;
  abrirTipo(catalogo.filter(function (t) { return t.id === it.dataset.tipoid; })[0]);
});
$('#btnTipo').addEventListener('click', function () { abrirTipo(null); });

function abrirTipo(t) {
  tipoActual = t || null;
  $('#tpTit').textContent = t ? 'Tipo de permiso o ausencia' : 'Nuevo tipo';
  $('#tpNombre').value = t ? t.nombre : '';
  $('#tpTrato').value  = t ? t.trato : 'acuerdo';
  $('#tpUnidad').value = t ? t.unidad : 'dia';
  $('#tpUnidadLibre').checked = t ? (t.unidad_fija === false) : false;
  $('#tpDoc').checked    = !!(t && t.pide_documento);
  $('#tpNota').checked   = !!(t && t.pide_nota);
  $('#tpExento').checked = !!(t && t.exento_bloqueos);
  $('#tpGoce').checked   = t ? !!t.con_goce : true;
  $('#tpConteo').checked = !!(t && t.suma_conteo_mes);
  $('#tpBase').value     = (t && t.base_legal) || '';
  $('#tpDias').value     = (t && t.dias_legales) || '';
  $('#tpDiasBase').value = (t && t.dias_base) || '';
  $('#tpOrden').value    = t ? t.orden : 100;
  $('#tpActivo').checked = t ? !!t.activo : true;
  $('#tpBajaHint').hidden = !t;

  /* EN UN TIPO DEL SISTEMA, LO LEGAL NO SE EDITA.

     Lo que queda abierto es lo que es decision del local: el nombre —cada uno
     le dice como quiere—, si esta activo, el orden, y pedir MAS papeles. Lo que
     se bloquea es lo que dice la ley: el trato, la unidad, el pago, la norma y
     los dias.

     No se esconde, se deshabilita: el encargado tiene que PODER VER que el
     duelo son 10 dias corridos del art. 66. Esconderlo haria que la pantalla
     parezca incompleta y que nadie sepa que la regla existe. */
  var sis = !!(t && t.de_sistema);
  ['#tpTrato','#tpUnidad','#tpUnidadLibre','#tpExento','#tpGoce','#tpConteo',
   '#tpBase','#tpDias','#tpDiasBase'].forEach(function (id) {
    $(id).disabled = sis;
  });
  $('#tpSistemaHint').hidden = !sis;

  pintarAyudaTrato();
  aviso('#tpMsg', '');
  $('#dlgTipo').showModal();
}

/* Qué significa el trato elegido, EN EL MOMENTO de elegirlo. Es el campo que
   más consecuencias tiene y el único cuyo nombre no se explica solo. */
function pintarAyudaTrato() {
  $('#tpTratoHint').innerHTML = AYUDA_TRATO[$('#tpTrato').value] || '';
}
$('#tpTrato').addEventListener('change', pintarAyudaTrato);
$('#tpCancelar').addEventListener('click', function () { $('#dlgTipo').close(); });

$('#tpGuardar').addEventListener('click', function () {
  var nombre = $('#tpNombre').value.trim();
  if (!nombre) return aviso('#tpMsg', 'Falta el nombre.', 'bad');

  var dias = $('#tpDias').value === '' ? null : Number($('#tpDias').value);
  var clase = $('#tpDiasBase').value || null;
  // El mismo `check` que tiene la tabla, dicho aquí en castellano: un número de
  // días sin decir de qué clase es un dato a medias, y al revés también.
  if ((dias === null) !== (clase === null))
    return aviso('#tpMsg', 'Si pones los días, di si son corridos o hábiles. Y al revés.', 'bad');

  var d = {
    nombre: nombre,
    trato: $('#tpTrato').value,
    unidad: $('#tpUnidad').value,
    unidad_fija: !$('#tpUnidadLibre').checked,
    pide_documento: $('#tpDoc').checked,
    pide_nota: $('#tpNota').checked,
    exento_bloqueos: $('#tpExento').checked,
    con_goce: $('#tpGoce').checked,
    suma_conteo_mes: $('#tpConteo').checked,
    base_legal: $('#tpBase').value.trim() || null,
    dias_legales: dias, dias_base: clase,
    orden: Number($('#tpOrden').value) || 100,
    activo: $('#tpActivo').checked,
  };

  /* Lo que se crea desde la pantalla es SIEMPRE del local: la plataforma no se
     amplia desde la pantalla de un cliente. Y al editar uno del sistema solo
     viajan los campos abiertos — si mandara los bloqueados, un `disabled` en el
     navegador seria toda la defensa, y eso no es una defensa. */
  if (tipoActual && tipoActual.de_sistema) {
    d = { nombre: d.nombre, activo: d.activo, orden: d.orden,
          pide_documento: d.pide_documento, pide_nota: d.pide_nota };
  } else {
    d.de_sistema = false;
    d.clave = null;
  }

  aviso('#tpMsg', 'Guardando…');
  var p = tipoActual ? DATOS.ausencias.guardarTipo(tipoActual.id, d)
                     : DATOS.ausencias.crearTipo(S.yo.empresa_id, d);
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'tipo_ausencia', fila.id,
                 tipoActual ? 'editar' : 'crear', tipoActual, fila);
    $('#dlgTipo').close();
    // El catálogo cambió: la semana tiene que releerlo, o la malla seguiría
    // pintando con los tipos viejos hasta que alguien recargue la página.
    return cargarCatalogo().then(recargarSemana);
  }).catch(function (e) {
    if (/tipos_ausencia_unicos/.test(e.message))
      return aviso('#tpMsg', 'Ya tienes un tipo con ese nombre.', 'bad');
    aviso('#tpMsg', e.message, 'bad');
  });
});

// ====================================================================
// DIAS BLOQUEADOS
//
// LA UNICA PUERTA CERRADA DEL SISTEMA, y esta bien que lo sea: la pidio Pedro
// para cerrar fin de año. Todo lo demas en esta app avisa; esto impide.
//
// Dos reglas que vienen de mirar como lo hace 7shifts y que Pedro aprobo:
//   · LA LICENCIA MEDICA PASA IGUAL. Un bloqueo es una politica del local y una
//     licencia no se pide: llega. Lo decide la columna `exento_bloqueos` del
//     tipo, no un `if` con el nombre escrito aca.
//   · SI UN SOLO DIA del rango que piden cae dentro, se bloquea la solicitud
//     ENTERA. Partirla a medias dejaria una ausencia que nadie reviso.
// ====================================================================
var bloqueoActual = null;

function cargarBloqueos() {
  if (!S.hayAusencias) return Promise.resolve([]);
  return DATOS.ausencias.bloqueos().then(function (f) {
    S.bloqueos = f; pintarBloqueos(); return f;
  }).catch(function (e) {
    $('#listaBloqueos').innerHTML = '<p class="vacio">' + esc(e.message) + '</p>';
  });
}

function pintarBloqueos() {
  $('#ctrlBloqueos').hidden = !S.hayAusencias;
  $('#hintBloqueos').hidden = !S.hayAusencias;
  if (!S.hayAusencias) { $('#listaBloqueos').innerHTML = ''; return; }
  if (!S.bloqueos.length) {
    $('#listaBloqueos').innerHTML = '<p class="vacio">No hay fechas bloqueadas.</p>';
    return;
  }
  $('#listaBloqueos').innerHTML = S.bloqueos.map(function (b) {
    var donde = b.sucursal_id ? nombreSucursal(b.sucursal_id) : 'todos los locales';
    var quien = b.cargo_id ? nombreCargo(b.cargo_id) : 'todos los cargos';
    return '<div class="item" data-bloqid="' + b.id + '">'
      + '<b>' + esc(diaMes(b.desde)) + ' — ' + esc(diaMes(b.hasta)) + '</b>'
      + '<span class="sub">' + esc(donde) + ' · ' + esc(quien)
      + (b.motivo ? ' · ' + esc(b.motivo) : '') + '</span></div>';
  }).join('');
}
function nombreSucursal(id) {
  for (var i = 0; i < S.sucursales.length; i++)
    if (S.sucursales[i].id === id) return S.sucursales[i].nombre;
  return 'ese local';
}

$('#listaBloqueos').addEventListener('click', function (ev) {
  var it = ev.target.closest('.item'); if (!it) return;
  abrirBloqueo(S.bloqueos.filter(function (b) { return b.id === it.dataset.bloqid; })[0]);
});
$('#btnBloqueo').addEventListener('click', function () { abrirBloqueo(null); });

function abrirBloqueo(b) {
  bloqueoActual = b || null;
  $('#blTit').textContent = b ? 'Fechas bloqueadas' : 'Bloquear fechas';
  $('#blLocal').innerHTML = '<option value="">Todos los locales</option>'
    + S.sucursales.map(function (x) {
        return '<option value="' + x.id + '">' + esc(x.nombre) + '</option>'; }).join('');
  $('#blCargo').innerHTML = '<option value="">Todos los cargos</option>'
    + S.cargos.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.nombre) + '</option>'; }).join('');
  $('#blDesde').value  = b ? b.desde : hoyTexto();
  $('#blHasta').value  = b ? b.hasta : hoyTexto();
  $('#blLocal').value  = (b && b.sucursal_id) || '';
  $('#blCargo').value  = (b && b.cargo_id) || '';
  $('#blMotivo').value = (b && b.motivo) || '';
  $('#blBorrar').hidden = !b;
  aviso('#blMsg', '');
  $('#dlgBloqueo').showModal();
}

$('#blCancelar').addEventListener('click', function () { $('#dlgBloqueo').close(); });
$('#blGuardar').addEventListener('click', function () {
  var d = {
    desde: $('#blDesde').value, hasta: $('#blHasta').value,
    sucursal_id: $('#blLocal').value || null,
    cargo_id: $('#blCargo').value || null,
    motivo: $('#blMotivo').value.trim() || null,
  };
  if (!d.desde || !d.hasta) return aviso('#blMsg', 'Faltan las fechas.', 'bad');
  if (d.hasta < d.desde) return aviso('#blMsg', 'La fecha de término es anterior a la de inicio.', 'bad');
  aviso('#blMsg', 'Guardando…');
  var p = bloqueoActual ? DATOS.ausencias.guardarBloqueo(bloqueoActual.id, d)
                        : DATOS.ausencias.crearBloqueo(S.yo.empresa_id, d);
  p.then(function (fila) {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'dia_bloqueado', fila.id,
                 bloqueoActual ? 'editar' : 'crear', bloqueoActual, fila);
    $('#dlgBloqueo').close();
    return cargarBloqueos();
  }).catch(function (e) { aviso('#blMsg', e.message, 'bad'); });
});

$('#blBorrar').addEventListener('click', function () {
  if (!bloqueoActual) return;
  if (!confirm('¿Quitar este bloqueo? Las fechas vuelven a quedar libres.')) return;
  DATOS.ausencias.borrarBloqueo(bloqueoActual.id).then(function () {
    DATOS.anotar(S.yo.empresa_id, S.yo.id, 'dia_bloqueado', bloqueoActual.id,
                 'borrar', bloqueoActual, null);
    $('#dlgBloqueo').close();
    return cargarBloqueos();
  }).catch(function (e) { aviso('#blMsg', e.message, 'bad'); });
});

/* ¿Choca con un bloqueo? Devuelve el que choca, o null.

   Se mira el RANGO COMPLETO que se pide, dia por dia: basta que uno caiga
   dentro. Y se respeta a quien alcanza el bloqueo — sin local es toda la
   empresa, sin cargo son todos los cargos. */
function bloqueoQueChoca(tipo, trabajadorId, desde, hasta) {
  if (!tipo || tipo.exento_bloqueos) return null;
  var persona = S.trabajadores.filter(function (p) { return p.id === trabajadorId; })[0];
  var cargos = (persona && persona.trabajador_cargos || []).map(function (x) { return x.cargo_id; });
  for (var i = 0; i < S.bloqueos.length; i++) {
    var b = S.bloqueos[i];
    if (b.desde > hasta || b.hasta < desde) continue;          // no se tocan
    if (b.cargo_id && cargos.indexOf(b.cargo_id) < 0) continue; // no es su cargo
    return b;
  }
  return null;
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
  abrirAusencia: abrirAusencia,
  abrirTipo: abrirTipo,
  abrirBloqueo: abrirBloqueo,
  cargarBloqueos: cargarBloqueos,
  cargarCatalogo: cargarCatalogo,
  desgloseAusencia: desgloseAusencia,
  marcarTurnosParaRevisar: marcarTurnosParaRevisar,
  recargarSemana: recargarSemana,
  prepararImpresion: prepararImpresion,
  // La planilla: marcar casillas y copiar/pegar. La prueba las llama directo
  // porque los gestos de ratón y las teclas no se pueden fingir de verdad
  // desde fuera, pero lo que corre es exactamente lo que corre al apretarlas.
  SEL: SEL, marcarRango: marcarRango, limpiarSeleccion: limpiarSeleccion,
  /* Solo para la prueba de humo: `PORTA` es de este archivo y no hay forma de
     vaciarlo desde fuera. Hace falta para comprobar que «Pegar» sale APAGADO
     cuando no hay nada copiado — y eso no se puede comprobar al final de una
     corrida donde ya se copió, que es justo donde el menú cae en la lista. */
  olvidarCopiado: function () { PORTA = null; },
  claveTurno: claveTurno, esClaveTurno: esClaveTurno, turnosDeClave: turnosDeClave,
  pintarMalla: pintarMalla, porHoraTurno: porHoraTurno, hhmm: hhmm, avisoPlan: avisoPlan,
  CFG_TOPE: CFG_TOPE, paso: paso, mostrar: mostrar, estadoNecesidad: estadoNecesidad,
  huecosDeNecesidad: huecosDeNecesidad, h2a: h2a, a2h: a2h,
  pintarSelectores: pintarSelectores,
  cerrarFicha: cerrarFicha, fichaCambiada: fichaCambiada,
  turnosMarcadosEn: turnosMarcadosEn, claveCelDeAsig: claveCelDeAsig,
  claveCel: claveCel,
  copiarSeleccion: copiarSeleccion, pegarSeleccion: pegarSeleccion,
  borrarSeleccion: borrarSeleccion, verPorta: function () { return PORTA; },
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
