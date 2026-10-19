/* La capa de datos. Todo lo que habla con la base pasa por aquí.

   SIN BIBLIOTECA DE TERCEROS, y la razón está medida, no supuesta.

   El 08-10 Pedro no podía entrar. Su navegador pasó las siete comprobaciones de
   `prueba.html` —la biblioteca cargaba, alcanzaba la base en 190 ms, el inicio
   de sesión contestaba en 102 ms, leer la sesión guardada 1 ms— y aun así la
   aplicación se quedaba esperando para siempre. Las mismas consultas, probadas
   contra el servidor con una sesión real, respondían en 0,30 s y 0,09 s.

   O sea: el servidor bien, la red bien, las llamadas HTTP directas bien. Lo
   único que se comportaba distinto en su navegador era la biblioteca. Se fueron
   catorce versiones persiguiéndola.

   Así que se va. Supabase expone una API HTTP corriente —PostgREST para los
   datos, GoTrue para las sesiones— y hablarle con `fetch` es su uso normal, no
   un truco. Lo que se pierde: el refresco en segundo plano y la suscripción a
   cambios en vivo, que esta aplicación no usa. Lo que se gana: que funcione en
   el navegador del dueño, y 218 KB menos que descargar.

   El aislamiento entre empresas NO se hace aquí. Lo hace RLS en la base. Este
   archivo no filtra por empresa al leer: si lo hiciera, bastaría una consulta
   olvidada para que una empresa viera datos de otra. */
(function () {
  'use strict';

  function cfg() {
    if (!window.CONFIG || window.CONFIG.SUPABASE_URL === 'PENDIENTE')
      throw new Error('Falta configurar el proyecto de Supabase en config.js.');
    return window.CONFIG;
  }

  /* Un almacén que no puede fallar. Si el navegador tiene bloqueado guardar
     datos de sitio, la sesión vive en memoria: se pierde al cerrar la pestaña
     —hay que volver a entrar—, que es mejor que no poder entrar. */
  var enMemoria = {}, CLAVE = 'turnos.sesion';
  function leerGuardado() {
    try { return window.localStorage.getItem(CLAVE); }
    catch (e) { return (CLAVE in enMemoria) ? enMemoria[CLAVE] : null; }
  }
  function escribirGuardado(v) {
    try { if (v === null) window.localStorage.removeItem(CLAVE);
          else window.localStorage.setItem(CLAVE, v); }
    catch (e) { if (v === null) delete enMemoria[CLAVE]; else enMemoria[CLAVE] = v; }
  }

  var sesion = null;
  (function () {
    var txt = leerGuardado();
    if (!txt) return;
    try { sesion = JSON.parse(txt); } catch (e) { escribirGuardado(null); }
  })();

  function guardar(s) { sesion = s; escribirGuardado(s ? JSON.stringify(s) : null); }

  /* Ninguna llamada puede colgarse en silencio, y cada una dice su nombre.
     Un colgado callado se ve igual que algo lento; un error se lee y se arregla. */
  function conTope(p, que, ms) {
    ms = ms || 20000;
    return Promise.race([p, new Promise(function (_, rechazar) {
      setTimeout(function () {
        rechazar(new Error('No hubo respuesta en ' + Math.round(ms / 1000)
                           + ' segundos al ' + que + '.'));
      }, ms);
    })]);
  }

  function cabeceras(conSesion) {
    var h = { apikey: cfg().SUPABASE_ANON, 'Content-Type': 'application/json' };
    h.Authorization = 'Bearer '
      + ((conSesion && sesion && sesion.access_token) || cfg().SUPABASE_ANON);
    return h;
  }

  // El cuerpo se lee UNA vez y de ahí sale el mensaje de error que venga.
  function respuesta(r, que) {
    return r.text().then(function (t) {
      var d = null;
      if (t) { try { d = JSON.parse(t); } catch (e) { d = null; } }
      if (!r.ok) {
        var dice = (d && (d.message || d.msg || d.error_description || d.error))
          || ('la base respondió ' + r.status + ' al ' + que);
        /* «JWT expired» es lo que contesta Supabase, y no es un mensaje para
           nadie: esta en ingles, nombra una sigla y no dice que hacer. Puede
           colarse aunque renovemos antes —si el token vence entre que sale la
           llamada y llega—, asi que se traduce aqui tambien. */
        if (/JWT|token is expired|invalid claim/i.test(dice)) {
          var ev = new Error('Tu sesión se venció. Entra de nuevo.');
          ev.sesionVencida = true;
          if (typeof cuenta.alCambiar === 'function') cuenta.alCambiar(ev);
          throw ev;
        }
        throw new Error(dice);
      }
      return d;
    });
  }

  /* LA SESION SE RENUEVA ANTES DE CADA LLAMADA, no solo al cargar la pagina.

     El token de Supabase dura una hora. La renovacion existia desde siempre
     —`cuenta.sesion()` la hace— pero SOLO se llamaba al arrancar, y `rest()`
     tomaba el token tal como estuviera. Resultado: a la hora de tener la
     pantalla abierta, TODO fallaba con «JWT expired» hasta recargar.

     Y una malla es justo lo que se deja abierto toda la tarde. Pedro lo vio el
     11-10 al guardar un turno despues de un rato: el mensaje en rojo era ese,
     en ingles y sin decirle que hacer.

     Renovar aqui no cuesta una llamada de mas: `cuenta.sesion()` devuelve al
     tiro si el token todavia sirve. Solo sale a la red cuando de verdad vencio. */
  function alDia() {
    if (!sesion || !sesion.access_token) return Promise.resolve();
    return cuenta.sesion().then(function (s) {
      if (s) return;
      // Habia sesion y la renovacion no la pudo salvar: no se disfraza de
      // error de permisos. Se dice, y se avisa a la pantalla para que lleve
      // a la persona a entrar de nuevo en vez de dejarla apretando botones.
      var e = new Error('Tu sesión se venció. Entra de nuevo.');
      e.sesionVencida = true;
      if (typeof cuenta.alCambiar === 'function') cuenta.alCambiar(e);
      throw e;
    });
  }

  function rest(camino, o, que) {
    o = o || {};
    return conTope(alDia().then(function () {
      return fetch(cfg().SUPABASE_URL + '/rest/v1/' + camino, {
        method: o.method || 'GET',
        headers: Object.assign(cabeceras(true), o.headers || {}),
        body: o.body ? JSON.stringify(o.body) : undefined,
      }).then(function (r) { return respuesta(r, que); });
    }), que);
  }

  function auth(camino, cuerpo, que) {
    return conTope(fetch(cfg().SUPABASE_URL + '/auth/v1/' + camino, {
      method: 'POST', headers: cabeceras(false), body: JSON.stringify(cuerpo),
    }).then(function (r) { return respuesta(r, que); }), que);
  }

  // ---------- entrar y salir ----------
  // `expires_in` viene en segundos: se guarda el INSTANTE de vencimiento para
  // no depender después de cuánto tiempo pasó.
  function conVencimiento(d) {
    d.expira_en = Date.now() + ((d.expires_in || 3600) - 60) * 1000;
    return d;
  }

  var cuenta = {
    entrar: function (email, clave) {
      return auth('token?grant_type=password', { email: email, password: clave }, 'entrar')
        .then(function (d) { guardar(conVencimiento(d)); return d; });
    },
    registrar: function (email, clave) {
      return auth('signup', { email: email, password: clave }, 'crear la cuenta')
        .then(function (d) {
          // Si el proyecto exige confirmar por correo, aún no viene sesión.
          if (d && d.access_token) guardar(conVencimiento(d));
          return { session: (d && d.access_token) ? d : null };
        });
    },
    /* La sesión guardada, renovada si hace falta. Si la renovación falla se
       borra y se vuelve al login: una sesión que no sirve y no se puede
       arreglar deja a la persona encerrada fuera, sin forma de salir. */
    sesion: function () {
      if (!sesion || !sesion.access_token) return Promise.resolve(null);
      if (Date.now() < (sesion.expira_en || 0)) return Promise.resolve(sesion);
      if (!sesion.refresh_token) { guardar(null); return Promise.resolve(null); }
      return auth('token?grant_type=refresh_token',
                  { refresh_token: sesion.refresh_token }, 'renovar la sesión')
        .then(function (d) { guardar(conVencimiento(d)); return sesion; })
        .catch(function () { guardar(null); return null; });
    },
    salir: function () {
      var tenia = sesion;
      guardar(null);
      // Que falle el aviso al servidor no puede impedir salir.
      if (tenia) fetch(cfg().SUPABASE_URL + '/auth/v1/logout',
        { method: 'POST', headers: cabeceras(true) }).catch(function () {});
      return Promise.resolve();
    },
    alCambiar: function () {},
  };

  // ---------- quién soy ----------
  // null = entró pero todavía no tiene empresa: es la primera vez.
  /* 🔴 ESTO PEDIA «UNA FILA CUALQUIERA», Y HASTA HOY HABIA UNA SOLA.

     Era `usuarios?select=*&limit=1` sin decir CUAL, y la politica de lectura
     deja ver todas las cuentas de la empresa (`empresa_id = mi_empresa()`).
     Con una sola cuenta —como estuvo este proyecto hasta esta tarde— acierta
     siempre. Con tres, Postgres no promete ningun orden sin `order by`: la app
     podia tomar la fila de OTRA persona y entonces `S.yo` entero quedaba mal
     —el rol, el correo del encabezado, el `usuario_id` con que se arma «Mi
     calendario», y el id con que se firma la BITACORA: acciones anotadas a
     nombre de quien no las hizo—.

     No es la base lo que fallaba: ella entrego lo que se le pidio. Aparecio
     al construir el reparto de permisos, que es justo la pantalla que existe
     porque hay varias cuentas. [[probar-el-camino-no-la-pieza]]

     El id sale de la sesion que ya esta guardada: GoTrue devuelve `user` junto
     al token, asi que no hace falta decodificar nada ni pedir una vuelta mas.
     Si por lo que sea no estuviera, se cae al comportamiento viejo en vez de
     dejar a la persona sin entrar: con una sola cuenta ese camino acierta, y
     quedarse fuera es peor que el riesgo que evita. */
  function yo() {
    var mio = sesion && sesion.user && sesion.user.id;
    var camino = mio ? 'usuarios?select=*&id=eq.' + encodeURIComponent(mio) + '&limit=1'
                     : 'usuarios?select=*&limit=1';
    return rest(camino, null, 'buscar tu cuenta')
      .then(function (f) { return (f && f[0]) || null; });
  }

  /* ---------- LAS CUENTAS QUE ENTRAN A LA EMPRESA ----------

     Hasta hoy la app solo LEIA `usuarios`, y una sola fila. Esto es lo que
     necesita la pantalla donde el dueño reparte los permisos.

     `order=creado` no es decoracion: la primera cuenta de la lista es la que
     abrio la empresa, y asi la lista no baila de un refresco a otro. */
  /* ---------- LAS INVITACIONES ----------
     «Este correo entra a mi empresa con este permiso». La tabla puede NO estar
     —Pedro pega los arreglos cuando puede— y la app tiene que andar igual:
     misma sonda que la jornada pactada y el rubro. Sin ella, el boton de dar
     acceso no se ofrece, en vez de ofrecerse y fallar. */
  var hayInvitaciones = null;
  function probarInvitaciones() {
    if (hayInvitaciones !== null) return Promise.resolve(hayInvitaciones);
    return rest('invitaciones?select=id&limit=1', null, 'ver las invitaciones')
      .then(function () { hayInvitaciones = true;  return true; })
      .catch(function () { hayInvitaciones = false; return false; });
  }

  var invitaciones = {
    hay: probarInvitaciones,
    /* Solo las PENDIENTES: una invitacion usada ya es una cuenta, y esa se ve
       en la lista de cuentas. Mostrar las dos listas con la misma persona en
       ambas obliga a preguntarse cual manda. */
    listar: function () {
      return rest('invitaciones?select=*&usada=is.null&order=creado',
                  null, 'leer las invitaciones pendientes');
    },
    crear: function (e, d) {
      return crear('invitaciones', Object.assign({ empresa_id: e }, d), 'dar el acceso');
    },
    cancelar: function (id) {
      return quitar('invitaciones', 'id=eq.' + id, 'cancelar la invitación');
    },
  };

  var usuarios = {
    listar: function () {
      return rest('usuarios?select=id,email,rol,creado&order=creado',
                  null, 'leer las cuentas de tu empresa');
    },
    /* El permiso se manda SOLO. Un PATCH con mas campos podria pisar el correo
       o la empresa de alguien por un descuido de la pantalla. */
    guardarPermiso: function (id, rol) {
      return editar('usuarios', id, { rol: rol }, 'cambiar el permiso de la cuenta');
    },
  };

  /* ---------- LA EMPRESA ----------
     Se lee para UNA cosa: el interruptor de si el supervisor ve los valores.
     La columna puede no estar —Pedro pega los arreglos cuando puede—, asi que
     se pide con `select=*` y la pantalla trata el campo ausente como apagado.
     Misma idea que las sondas de rubro y jornada: la app anda igual sin el. */
  function miEmpresa() {
    return rest('empresas?select=*&limit=1', null, 'leer tu empresa')
      .then(function (f) { return (f && f[0]) || null; })
      .catch(function () { return null; });
  }
  function guardarEmpresa(id, d) {
    return editar('empresas', id, d, 'guardar la configuracion de la empresa');
  }

  function primeraVez(nombreEmpresa) {
    return rest('rpc/crear_empresa', { method: 'POST', body: { p_nombre: nombreEmpresa } },
                'crear la empresa');
  }

  // ---------- ayudas ----------
  var devolver = { Prefer: 'return=representation' };
  function primero(f) { return (f && f[0]) || null; }
  function crear(tabla, d, que) {
    return rest(tabla, { method: 'POST', body: d, headers: devolver }, que).then(primero);
  }
  /* IGUAL QUE `crear`, PERO DEVUELVE TODAS LAS FILAS.
     `crear` se queda con la primera —`primero`—, que es lo correcto cuando se
     inserta una. Al insertar un lote eso tira a la basura los identificadores
     de todo lo demas, y sin ellos NO SE PUEDE DESHACER: para retirar lo que se
     acaba de crear hay que saber que se creo. No se cambia `crear` porque la
     usan muchos sitios que esperan una fila sola. */
  function crearVarios(tabla, filas, que) {
    return rest(tabla, { method: 'POST', body: filas, headers: devolver }, que)
      .then(function (f) { return f || []; });
  }
  function editar(tabla, id, d, que) {
    return rest(tabla + '?id=eq.' + id, { method: 'PATCH', body: d, headers: devolver }, que)
      .then(primero);
  }
  function quitar(tabla, filtro, que) {
    return rest(tabla + '?' + filtro, { method: 'DELETE' }, que);
  }

  // ---------- catálogos ----------
  /* ¿Está pegada la migración del horario del local?

     Hace falta saberlo ANTES de guardar: si las columnas no existen y se
     mandan igual, PostgREST rechaza el POST entero y dejaría de poder
     guardarse un local — o sea, una migración sin pegar rompiendo la app, que
     es justo lo que no puede pasar. Leer es seguro (`select=*` simplemente no
     las trae); escribir no.

     Se pregunta por las columnas, no por las filas: una empresa recién creada
     no tiene locales todavía y mirar el primero no diría nada. */
  var hayHorarioLocal = null;
  function probarHorarioLocal() {
    if (hayHorarioLocal !== null) return Promise.resolve(hayHorarioLocal);
    return rest('sucursales?select=abre,cierra&limit=1', null, 'ver el horario del local')
      .then(function () { hayHorarioLocal = true;  return true; })
      .catch(function () { hayHorarioLocal = false; return false; });
  }

  var sucursales = {
    listar: function () { return rest('sucursales?select=*&order=nombre', null, 'leer los locales'); },
    hayHorario: probarHorarioLocal,
    hayRubro: probarRubro,
    crear:  function (e, d) { return crear('sucursales', Object.assign({ empresa_id: e }, d), 'crear el local'); },
    guardar:function (id, d) { return editar('sucursales', id, d, 'guardar el local'); },
  };

  var cargos = {
    listar: function () { return rest('cargos?select=*&activo=eq.true&order=nombre', null, 'leer los cargos'); },
    crear:  function (e, d) { return crear('cargos', Object.assign({ empresa_id: e }, d), 'crear el cargo'); },
    guardar:function (id, d) { return editar('cargos', id, d, 'guardar el cargo'); },
  };
  /* Misma sonda que para el rubro: se LEE la columna y si la base no la tiene
     la app sigue andando sin ese campo. Pedro pega los arreglos cuando puede. */
  var hayJornadaPactada = null;
  function probarJornada() {
    if (hayJornadaPactada !== null) return Promise.resolve(hayJornadaPactada);
    return rest('trabajadores?select=jornada_pactada&limit=1', null, 'ver la jornada pactada')
      .then(function () { hayJornadaPactada = true;  return true; })
      .catch(function () { hayJornadaPactada = false; return false; });
  }


  /* Misma sonda, para la casilla «no hace turnos» de la alternativa C. */
  var hayNoHaceTurnos = null;
  function probarNoTurnos() {
    if (hayNoHaceTurnos !== null) return Promise.resolve(hayNoHaceTurnos);
    return rest('trabajadores?select=no_hace_turnos&limit=1', null, 'ver quién no hace turnos')
      .then(function () { hayNoHaceTurnos = true;  return true; })
      .catch(function () { hayNoHaceTurnos = false; return false; });
  }

  var trabajadores = {
    hayJornada: probarJornada,
    hayNoTurnos: probarNoTurnos,
    listar: function () {
      /* SE TRAEN TODOS, también los que ya no trabajan aquí.

         Antes esto filtraba `activo=eq.true` y parecía lo correcto. No lo es:
         la pantalla resuelve el nombre de cada turno buscando en esta lista, y
         quien no esté sale como «—». O sea que archivar a alguien le habría
         borrado el nombre de TODOS sus turnos pasados — justo lo contrario de
         lo que archivar promete.

         Quién existe y a quién se le puede asignar un turno son dos preguntas
         distintas. Esta trae a todos; la de ofrecer filtra (`activos()`). */
      return rest('trabajadores?select=*,trabajador_cargos(cargo_id),trabajador_sucursales(sucursal_id)'
                  + '&order=nombre', null, 'leer los trabajadores');
    },
    crear:  function (e, d) { return crear('trabajadores', Object.assign({ empresa_id: e }, d), 'crear el trabajador'); },
    guardar:function (id, d) { return editar('trabajadores', id, d, 'guardar el trabajador'); },
    ponerCargos: function (id, cs) {
      return quitar('trabajador_cargos', 'trabajador_id=eq.' + id, 'guardar los cargos').then(function () {
        if (!cs.length) return [];
        return rest('trabajador_cargos', { method: 'POST', body: cs.map(function (c) {
          return { trabajador_id: id, cargo_id: c }; }) }, 'guardar los cargos');
      });
    },
    ponerSucursales: function (id, ss) {
      return quitar('trabajador_sucursales', 'trabajador_id=eq.' + id, 'guardar los locales').then(function () {
        if (!ss.length) return [];
        return rest('trabajador_sucursales', { method: 'POST', body: ss.map(function (s) {
          return { trabajador_id: id, sucursal_id: s }; }) }, 'guardar los locales');
      });
    },

    /* DE A UNA FILA — el paso 1 de «guardar al momento» (19-10-2026).

       `ponerCargos` y `ponerSucursales` BORRAN TODO Y REINSERTAN. Eso esta bien
       para un boton que se aprieta una vez, y es justo lo que NO sirve cuando
       cada casilla guarda sola: dos clics seguidos se pisan, porque el segundo
       parte de una lista que el primero todavia no termino de escribir.

       Por eso estas cuatro. No reemplazan a las de arriba —el alta de un
       trabajador nuevo sigue mandando el conjunto de una vez, que ahi es lo
       correcto—: conviven. */
    agregarCargo: function (id, c) {
      return rest('trabajador_cargos', { method: 'POST',
        body: { trabajador_id: id, cargo_id: c } }, 'agregar el cargo');
    },
    quitarCargo: function (id, c) {
      return quitar('trabajador_cargos',
        'trabajador_id=eq.' + id + '&cargo_id=eq.' + c, 'quitar el cargo');
    },
    agregarSucursal: function (id, su) {
      return rest('trabajador_sucursales', { method: 'POST',
        body: { trabajador_id: id, sucursal_id: su } }, 'agregar el local');
    },
    quitarSucursal: function (id, su) {
      return quitar('trabajador_sucursales',
        'trabajador_id=eq.' + id + '&sucursal_id=eq.' + su, 'quitar el local');
    },
  };

  /* ¿Está pegada la migración de los atajos por local? Mismo cuidado que con
     el horario del local: leer es seguro, escribir no. */
  var hayHorarioPorLocal = null;
  function probarHorarioPorLocal() {
    if (hayHorarioPorLocal !== null) return Promise.resolve(hayHorarioPorLocal);
    return rest('horarios?select=sucursal_id&limit=1', null, 'ver los atajos por local')
      .then(function () { hayHorarioPorLocal = true;  return true; })
      .catch(function () { hayHorarioPorLocal = false; return false; });
  }

  /* La misma sonda que para el horario por local: se LEE una columna y, si la
     base no la tiene, la app sigue andando sin ese campo en vez de caerse.
     Pedro pega los arreglos cuando puede, no cuando yo publico. */
  var hayRubroLocal = null;
  function probarRubro() {
    if (hayRubroLocal !== null) return Promise.resolve(hayRubroLocal);
    return rest('sucursales?select=rubro&limit=1', null, 'ver el rubro del local')
      .then(function () { hayRubroLocal = true;  return true; })
      .catch(function () { hayRubroLocal = false; return false; });
  }

  var horarios = {
    listar: function () { return rest('horarios?select=*&order=hora_inicio', null, 'leer los horarios'); },
    hayPorLocal: probarHorarioPorLocal,
    crear:  function (e, d) { return crear('horarios', Object.assign({ empresa_id: e }, d), 'crear el horario'); },
    // Editar no existia: la ficha abria y el Guardar no hacia nada. Se nota
    // recien ahora, porque antes no habia ningun campo que valiera la pena
    // cambiar — el local si lo es.
    guardar:function (id, d) { return editar('horarios', id, d, 'guardar el tramo'); },
    borrar: function (id) { return quitar('horarios', 'id=eq.' + id, 'borrar el horario'); },
  };

  // ---------- el núcleo ----------
  function delRango(tabla, suc, desde, hasta, que) {
    return rest(tabla + '?select=*&sucursal_id=eq.' + suc
                + '&fecha=gte.' + desde + '&fecha=lte.' + hasta
                + '&order=fecha&order=hora_inicio', null, que);
  }

  var necesidades = {
    listar: function (s, a, b) { return delRango('necesidades', s, a, b, 'leer lo planificado'); },
    crear:  function (d) { return crear('necesidades', d, 'guardar lo planificado'); },
    crearVarios: function (f) { return crearVarios('necesidades', f, 'guardar lo planificado'); },
    guardar:function (id, d) { return editar('necesidades', id, d, 'guardar lo planificado'); },
    borrar: function (id) { return quitar('necesidades', 'id=eq.' + id, 'borrar lo planificado'); },
  };

  var asignaciones = {
    listar: function (s, a, b) { return delRango('asignaciones', s, a, b, 'leer las asignaciones'); },
    /* LOS TURNOS DE UNA PERSONA EN UNAS FECHAS, EN TODOS LOS LOCALES.

       Para saber si un turno nuevo se pisa con otro que ya tiene. Va a la base
       y no a lo que hay en pantalla por dos razones:
         · la pantalla solo tiene la semana visible, y un turno del DOMINGO
           ANTERIOR que cruza la medianoche se mete en el lunes;
         · y sobre todo, NO FILTRA POR LOCAL: nadie puede estar en el Centro y
           en el Norte a la misma hora, y si solo mirara el local de la pantalla
           ese choque pasaria sin que nadie lo vea.

       Las anuladas no cuentan: dejaron de ocupar a nadie. */
    deLaPersona: function (trabajadorId, desde, hasta) {
      return rest('asignaciones?select=*&trabajador_id=eq.' + trabajadorId
                  + '&estado=neq.anulada'
                  + '&fecha=gte.' + desde + '&fecha=lte.' + hasta
                  + '&order=fecha&order=hora_inicio', null, 'ver los turnos de esa persona');
    },
    crear:  function (d) { return crear('asignaciones', d, 'guardar la asignación'); },
    crearVarios: function (f) { return crearVarios('asignaciones', f, 'guardar los turnos'); },
    guardar:function (id, d) { return editar('asignaciones', id, d, 'guardar la asignación'); },
    borrar: function (id) { return quitar('asignaciones', 'id=eq.' + id, 'quitar la asignación'); },
  };

  var turnos = {
    listar: function (s, a, b) { return delRango('turnos', s, a, b, 'leer los turnos'); },
    // Lo que ve el trabajador: SOLO lo publicado. El borrador no sale de aquí.
    mios: function (t, a, b) {
      return rest('turnos?select=*&trabajador_id=eq.' + t + '&estado=eq.publicado'
                  + '&fecha=gte.' + a + '&fecha=lte.' + b
                  + '&order=fecha&order=hora_inicio', null, 'leer tus turnos');
    },
    crearLote: function (filas) {
      return rest('turnos', { method: 'POST', body: filas, headers: devolver }, 'publicar');
    },
    guardar:  function (id, d) { return editar('turnos', id, d, 'actualizar el turno'); },
    borrarDe: function (ids) {
      return quitar('turnos', 'asignacion_id=in.(' + ids.join(',') + ')', 'quitar el turno');
    },
  };

  /* Auditoría: se graba desde el primer día porque «quién cambió este turno» no
     se reconstruye después. Si falla, NO se cae la operación: perder el rastro
     de un cambio es malo; impedir que alguien trabaje porque el rastro falló es
     peor. */
  function anotar(empresaId, usuarioId, entidad, entidadId, accion, antes, despues) {
    return rest('eventos', { method: 'POST', body: {
      empresa_id: empresaId, usuario_id: usuarioId, entidad: entidad,
      entidad_id: entidadId || null, accion: accion,
      antes: antes || null, despues: despues || null,
    } }, 'anotar el cambio').catch(function (e) {
      console.warn('no se pudo anotar el evento:', e.message);
    });
  }

  /* LA BITÁCORA. Se lee lo último primero y con tope: una empresa con meses
     de uso tiene miles de eventos y nadie baja hasta el fondo. El «ver más»
     pide otra tanda con `offset`. */
  var eventos = {
    listar: function (desde, cuantos) {
      return rest('eventos?select=*&order=cuando.desc'
                  + '&limit=' + (cuantos || 50) + '&offset=' + (desde || 0),
                  null, 'leer la bitácora');
    },
    delTurno: function (entidad, id) {
      return rest('eventos?select=*&entidad=eq.' + entidad + '&entidad_id=eq.' + id
                  + '&order=cuando.desc', null, 'leer el historial');
    },
  };

  /* PLANTILLAS. Mismo cuidado que con las otras migraciones: se pregunta si
     las tablas existen antes de usarlas, y si no están la app no muestra los
     botones en vez de reventar. */
  var hayPlantillas = null;
  var plantillas = {
    hay: function () {
      if (hayPlantillas !== null) return Promise.resolve(hayPlantillas);
      return rest('plantillas?select=id&limit=1', null, 'ver las plantillas')
        .then(function () { hayPlantillas = true;  return true; })
        .catch(function () { hayPlantillas = false; return false; });
    },
    listar: function () {
      return rest('plantillas?select=*&order=nombre', null, 'leer las plantillas');
    },
    lineas: function (id) {
      return rest('plantilla_lineas?select=*&plantilla_id=eq.' + id + '&order=dow',
                  null, 'leer la plantilla');
    },
    crear: function (e, d) {
      return crear('plantillas', Object.assign({ empresa_id: e }, d), 'guardar el modelo');
    },
    ponerLineas: function (e, pid, lineas) {
      if (!lineas.length) return Promise.resolve([]);
      return rest('plantilla_lineas', { method: 'POST', body: lineas.map(function (l) {
        return Object.assign({ empresa_id: e, plantilla_id: pid }, l);
      }) }, 'guardar las líneas del modelo');
    },
    borrar: function (id) { return quitar('plantillas', 'id=eq.' + id, 'borrar el modelo'); },
  };

  /* ---------- ausencias ----------

     MISMO RESGUARDO QUE LAS PLANTILLAS: si la migracion no esta pegada, la app
     esconde los botones en vez de reventar. `hay()` lo pregunta una sola vez.

     POR QUE LOS TIPOS SE PIDEN APARTE y no incrustados en la consulta de
     ausencias: la clave foranea a `tipos_ausencia` es COMPUESTA
     (empresa_id, tipo_id), y PostgREST no la resuelve sola para incrustar.
     Pedirlos por separado y cruzarlos aca es mas corto que pelear con eso, y
     ademas el catalogo se usa en varias pantallas: una sola lectura sirve a
     todas. */
  var hayAusencias = null;
  var cacheTipos = null;

  var ausencias = {
    hay: function () {
      if (hayAusencias !== null) return Promise.resolve(hayAusencias);
      return rest('tipos_ausencia?select=id&limit=1', null, 'ver las ausencias')
        .then(function () { hayAusencias = true;  return true; })
        .catch(function () { hayAusencias = false; return false; });
    },

    tipos: function (recargar) {
      if (cacheTipos && !recargar) return Promise.resolve(cacheTipos);
      return rest('tipos_ausencia?select=*&activo=eq.true&order=orden',
                  null, 'leer los tipos de ausencia')
        .then(function (f) { cacheTipos = f; return f; });
    },

    /* LO QUE SE PISA CON LA SEMANA, no lo que empieza dentro de ella.

       Una licencia del 28 de marzo al 4 de abril TIENE que salir en la semana
       del 1 de abril aunque no empiece ahi. Preguntar por `desde` dentro del
       rango —que es lo que uno escribe sin pensar— la dejaria fuera justo
       cuando mas importa, y la malla volveria a mentir.

       Las anuladas no vienen: dejaron de existir para la malla, pero se
       guardan para la bitacora. */
    listar: function (desde, hasta) {
      return rest('ausencias?select=*&estado=neq.anulada'
                  + '&desde=lte.' + hasta + '&hasta=gte.' + desde + '&order=desde',
                  null, 'leer las ausencias');
    },

    /* El catalogo se edita desde la pantalla, no desde la base: es lo que
       permite que Pedro mantenga las reglas solo cuando cambie la ley.
       `recargar` fuerza a releerlo, porque el catalogo esta en cache. */
    crearTipo: function (e, d) {
      cacheTipos = null;
      return crear('tipos_ausencia', Object.assign({ empresa_id: e }, d), 'crear el tipo');
    },
    guardarTipo: function (id, d) {
      cacheTipos = null;
      return editar('tipos_ausencia', id, d, 'guardar el tipo');
    },
    /* TODOS los tipos, incluidos los desactivados: la pantalla del catalogo
       tiene que poder volver a encender uno. `tipos()` sigue devolviendo solo
       los activos, que es lo que corresponde al registrar. */
    tiposTodos: function () {
      return rest('tipos_ausencia?select=*&order=orden', null, 'leer el catálogo');
    },

    crear: function (e, d) {
      return crear('ausencias', Object.assign({ empresa_id: e }, d), 'guardar la ausencia');
    },
    guardar: function (id, d) { return editar('ausencias', id, d, 'guardar la ausencia'); },

    /* Anular NO borra: la ausencia sigue en la base y en la bitacora. Borrarla
       dejaria un turno marcado para revisar sin nada que explique por que. */
    anular: function (id) {
      return editar('ausencias', id, { estado: 'anulada' }, 'anular la ausencia');
    },

    /* El detalle por dia. Se escribe DE UNA VEZ al resolver, y es una
       fotografia: no se recalcula despues aunque la malla cambie. Por eso se
       borra y se repone en bloque en vez de ir parcheando filas sueltas. */
    ponerDias: function (e, ausenciaId, filas) {
      return quitar('ausencia_dias', 'ausencia_id=eq.' + ausenciaId, 'rehacer el detalle')
        .then(function () {
          if (!filas.length) return [];
          return rest('ausencia_dias', { method: 'POST', body: filas.map(function (f) {
            return Object.assign({ empresa_id: e, ausencia_id: ausenciaId }, f);
          }) }, 'guardar el detalle por dia');
        });
    },
    /* Dias bloqueados. Se leen con la semana y tambien al registrar, porque el
       rango que pide alguien puede caer fuera de la semana que esta a la vista. */
    bloqueos: function () {
      return rest('dias_bloqueados?select=*&order=desde', null, 'leer los días bloqueados');
    },
    crearBloqueo: function (e, d) {
      return crear('dias_bloqueados', Object.assign({ empresa_id: e }, d), 'guardar el bloqueo');
    },
    guardarBloqueo: function (id, d) {
      return editar('dias_bloqueados', id, d, 'guardar el bloqueo');
    },
    borrarBloqueo: function (id) {
      return quitar('dias_bloqueados', 'id=eq.' + id, 'quitar el bloqueo');
    },

    dias: function (ausenciaId) {
      return rest('ausencia_dias?select=*&ausencia_id=eq.' + ausenciaId + '&order=fecha',
                  null, 'leer el detalle por dia');
    },
  };

  window.DATOS = {
    auth: cuenta, yo: yo, primeraVez: primeraVez,
    miEmpresa: miEmpresa, guardarEmpresa: guardarEmpresa, usuarios: usuarios,
    invitaciones: invitaciones,
    sucursales: sucursales, cargos: cargos, trabajadores: trabajadores, eventos: eventos,
    plantillas: plantillas, ausencias: ausencias,
    horarios: horarios, necesidades: necesidades, asignaciones: asignaciones,
    turnos: turnos, anotar: anotar,
  };
})();
