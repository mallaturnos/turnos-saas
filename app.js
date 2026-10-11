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
  var sueltas = S.asignaciones.filter(function (a) { return a.fecha === f && !a.necesidad_id; });

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
    if (f.pide && f.pide.length) {
      f.pide.forEach(function (n, k) {
        var i = a2h(n.hora_inicio), ff = a2h(n.hora_fin); if (ff <= i) ff += 24;
        html += '<div class="lfila" data-fila="' + (f.id || '') + '">'
              + '<span class="lrot">' + (k === 0 ? esc(f.nombre) : '') + '</span>'
              + '<div class="lpista">'
              + '<span class="lpide" data-necid="' + n.id + '"'
              + ' style="left:' + pct(i) + '%;width:' + (pct(ff) - pct(i)) + '%"'
              + ' title="Hacen falta ' + n.personas_requeridas + ' · '
              + rangoTxt(n.hora_inicio, n.hora_fin) + '">'
              + '<span class="lpidetxt">hacen falta ' + n.personas_requeridas + '</span>'
              + '<span class="tirador izq"></span><span class="tirador der"></span>'
              + '</span></div></div>';
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
      // El nombre del grupo solo en la primera línea, si no hay fila de pedido.
      var rot = (!f.pide || !f.pide.length) && k === 0 ? esc(f.nombre) : '';
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
  var titulo = choca ? ' title="' + esc(quien + ' tiene ' + ausTxt + ' ese día') + '"' : '';
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
  var pie = abajo === 'cargo' ? nombreCargo(a.cargo_id)
          : (sinDueno ? 'sin asignar' : nombreTrab(a.trabajador_id));
  return '<li class="blq ' + colorCargo(a.cargo_id)
       + (sinDueno ? ' pendiente' : (publicado ? ' publicado' : ' borrador'))
       + '" data-asigid="' + a.id + '">'
       + '<b>' + hhmm(a.hora_inicio) + '–' + hhmm(a.hora_fin) + '</b>'
       // Mismo formato H:MM que en todo el resto: dos maneras de escribir lo
       // mismo obligan a traducir mentalmente, y eso ya es un costo.
       + '<span class="dur">' + durTexto(a.hora_inicio, a.hora_fin) + '</span>'
       + '<em>' + esc(pie) + '</em>' + botonQuitar(a) + '</li>';
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
    html += '<tr' + (fila.suelto ? ' class="suelto"' : '') + '><th class="rot">'
          + esc(fila.nombre) + '</th>';
    dias.forEach(function (f) {
      var suyas = S.asignaciones.filter(function (a) {
        return a.fecha === f && deQuien(a) === fila.id;
      });
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
      S.agrupar === 'persona' ? { trabajadorId: quien } : { cargoId: quien });
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
  $('#aCargoCaja').hidden = !!n;
  $('#aCargo').innerHTML = S.cargos.map(function (q) {
    return '<option value="' + q.id + '">' + esc(q.nombre) + '</option>';
  }).join('');
  if (cargoId) $('#aCargo').value = cargoId;
  var sabe = [], resto = [];
  S.trabajadores.forEach(function (p) {
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
  pintarDeQuien();
  pintarOjo();
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
  $('#aDe').innerHTML = '<b>Turno suelto</b> — va a quedar en '
    + (pid ? '<b>' + esc(nombreTrab(pid)) + '</b>' : '<b>Sin asignar</b>')
    + (cid ? ' · ' + esc(nombreCargo(cid)) : '')
    + (asigFecha ? ' · <b>' + nombreDia(asigFecha) + ' ' + diaMes(asigFecha) + '</b>' : '')
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
function alCambiarFicha() { pintarDeQuien(); pintarOjo(); }
$('#aQuien').addEventListener('change', alCambiarFicha);
// Cambiar el cargo también: el aviso depende de los dos, no solo de la persona.
$('#aCargo').addEventListener('change', alCambiarFicha);

$('#aCancelar').addEventListener('click', function () { $('#dlgAsig').close(); });
$('#aGuardar').addEventListener('click', function () {
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
  revisarChoque(d).then(function (choque) {
    if (choque) return aviso('#aMsg', choque, 'bad');
    return guardarAsignacion(d);
  }).catch(function (e) { aviso('#aMsg', e.message, 'bad'); });
});

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
    return '<b>No puede estar en dos turnos a la vez.</b> Se cruza <b>' + minTexto(min)
      + '</b> con su turno de ' + esc(rangoTxt(pisa.hora_inicio, pisa.hora_fin))
      + ' del ' + esc(nombreDia(pisa.fecha)) + ' ' + esc(diaMes(pisa.fecha))
      + '. Cambia las horas o mueve el otro.';
  });
}

function guardarAsignacion(d) {
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

var SEL = { claves: [], ancla: null, pintando: false, arrastro: false, tragarClic: false };
var PORTA = null;   // lo copiado: { agrupar, alto, ancho, celdas: [[ [turnos] ]] }

function esPlanilla() { return S.agrupar === 'persona' || S.agrupar === 'cargo'; }

function claveCel(td) {
  return S.agrupar + '|' + (td.dataset.fila || '') + '|' + td.dataset.fecha;
}
function partesClave(k) {
  var i = k.indexOf('|'), j = k.lastIndexOf('|');
  return { agrupar: k.slice(0, i), fila: k.slice(i + 1, j), fecha: k.slice(j + 1) };
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
function turnosDeClave(k) {
  var p = partesClave(k);
  return S.asignaciones.filter(function (a) {
    var mio = p.agrupar === 'persona' ? (a.trabajador_id || '') : (a.cargo_id || '');
    return a.fecha === p.fecha && String(mio) === p.fila;
  }).sort(function (u, v) {
    return hhmm(u.hora_inicio) < hhmm(v.hora_inicio) ? -1 : 1;
  });
}

function limpiarSeleccion() {
  SEL.claves = []; SEL.ancla = null;
  pintarSeleccion();
}

function pintarSeleccion() {
  $$('#malla td.cel').forEach(function (td) {
    var k = claveCel(td);
    td.classList.toggle('sel', SEL.claves.indexOf(k) >= 0);
    td.classList.toggle('ancla', k === SEL.ancla);
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
        + ' con <b>Ctrl+C</b> y <b>Ctrl+V</b>. <b>Supr</b> las quita.</span>'
      : '<span class="teclas">Para copiar y pegar turnos, cambia a'
        + ' <b>Personas</b> o <b>Cargos</b>.</span>';
    return;
  }
  caja.classList.remove('pista');
  caja.hidden = false;
  var n = SEL.claves.length;
  var turnos = SEL.claves.reduce(function (t, k) { return t + turnosDeClave(k).length; }, 0);
  caja.innerHTML = '<b>' + n + '</b> ' + (n === 1 ? 'casilla' : 'casillas')
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
  SEL.claves.forEach(function (k) { var p = g.mapa[k]; if (p) { fs.push(p.f); cs.push(p.c); } });
  if (!fs.length) return;
  var f1 = Math.min.apply(null, fs), f2 = Math.max.apply(null, fs);
  var c1 = Math.min.apply(null, cs), c2 = Math.max.apply(null, cs);
  var celdas = [];
  for (var f = f1; f <= f2; f++) {
    var linea = [];
    for (var c = c1; c <= c2; c++) {
      var td = g.filas[f] && g.filas[f][c];
      linea.push(!td ? [] : turnosDeClave(claveCel(td)).map(function (a) {
        return { hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
                 cargo_id: a.cargo_id, trabajador_id: a.trabajador_id };
      }));
    }
    celdas.push(linea);
  }
  PORTA = { agrupar: S.agrupar, alto: f2 - f1 + 1, ancho: c2 - c1 + 1, celdas: celdas };
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

  // El destino es la esquina de arriba a la izquierda de lo marcado, aunque
  // haya marcado un rango más grande: igual que una planilla.
  var fs = [], cs = [];
  SEL.claves.forEach(function (k) { var p = g.mapa[k]; if (p) { fs.push(p.f); cs.push(p.c); } });
  if (!fs.length) return nada();
  var f0 = Math.min.apply(null, fs), c0 = Math.min.apply(null, cs);

  var crear = [], borrar = [], fuera = 0, dormidos = 0;
  for (var i = 0; i < PORTA.alto; i++) {
    for (var j = 0; j < PORTA.ancho; j++) {
      var td = g.filas[f0 + i] && g.filas[f0 + i][c0 + j];
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
        crear.push({
          empresa_id: S.yo.empresa_id, sucursal_id: S.sucursal,
          necesidad_id: null,
          // La cara que manda es la de la FILA de destino; la otra viaja con
          // lo copiado. Pegar en la fila de Ana hace que el turno sea de Ana.
          trabajador_id: p.agrupar === 'persona' ? (p.fila || null) : (t.trabajador_id || null),
          cargo_id:      p.agrupar === 'cargo'   ? p.fila : t.cargo_id,
          fecha: p.fecha, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin,
          origen: 'mano', tocado_a_mano: true, estado: 'confirmada',
        });
      });
    }
  }

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
  crear.forEach(function (d) {
    cadena = cadena.then(function () {
      // Un choque con el índice único no bota el pegado entero: se cuenta y
      // se sigue. Parar a la mitad dejaría la semana por la mitad, que es peor
      // que pegar casi todo y decir cuántos no entraron.
      return DATOS.asignaciones.crear(d)
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

// ---------- los gestos ----------
$('#malla').addEventListener('mousedown', function (ev) {
  if (!esPlanilla()) return;
  // La × hace lo suyo y no toca la marca: quitar un turno no es marcarlo.
  if (ev.target.dataset && (ev.target.dataset.quitar || ev.target.dataset.agregar)) return;
  var td = ev.target.closest && ev.target.closest('td.cel');
  if (!td) return;
  var k = claveCel(td);
  // Con Mayús se extiende desde donde estaba; sin nada, se empieza de cero.
  if (ev.shiftKey && SEL.ancla) { marcarRango(SEL.ancla, k); return; }
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
  if (SEL.arrastro) {
    SEL.tragarClic = true;
    setTimeout(function () { SEL.tragarClic = false; }, 0);
  }
  SEL.pintando = false; SEL.arrastro = false;
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
document.addEventListener('keydown', function (ev) {
  if (escribiendo(ev)) return;
  if (ev.key === 'Escape' && SEL.claves.length) { limpiarSeleccion(); return; }
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

['#listaTrabajadores','#listaCargos'].forEach(function (sel) {
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
  if (!S.trabajadores.length)
    return alert('Primero crea a alguien en Equipo.');

  ausActual = a || null;
  /* «Ausencia / permiso», como lo pidio Pedro (msg 5512).

     Nadie dice «ausencia» en un local: se dice permiso, licencia, vacaciones o
     falta segun el caso. Las dos palabras juntas son el paraguas que se
     entiende sin explicar, y evita el error de llamarle «permiso» a una
     licencia medica —que nadie concede— o a una falta. */
  $('#usTit').textContent = a ? 'Ausencia / permiso' : 'Registrar una ausencia / permiso';

  $('#usQuien').innerHTML = S.trabajadores.map(opcion).join('');
  $('#usQuien').value = a ? a.trabajador_id : (trabajadorId || S.trabajadores[0].id);

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
