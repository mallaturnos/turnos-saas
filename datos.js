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
        throw new Error((d && (d.message || d.msg || d.error_description || d.error))
          || ('la base respondió ' + r.status + ' al ' + que));
      }
      return d;
    });
  }

  function rest(camino, o, que) {
    o = o || {};
    return conTope(fetch(cfg().SUPABASE_URL + '/rest/v1/' + camino, {
      method: o.method || 'GET',
      headers: Object.assign(cabeceras(true), o.headers || {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
    }).then(function (r) { return respuesta(r, que); }), que);
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
  function yo() {
    return rest('usuarios?select=*&limit=1', null, 'buscar tu cuenta')
      .then(function (f) { return (f && f[0]) || null; });
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
    crear:  function (e, d) { return crear('sucursales', Object.assign({ empresa_id: e }, d), 'crear el local'); },
    guardar:function (id, d) { return editar('sucursales', id, d, 'guardar el local'); },
  };

  var cargos = {
    listar: function () { return rest('cargos?select=*&activo=eq.true&order=nombre', null, 'leer los cargos'); },
    crear:  function (e, d) { return crear('cargos', Object.assign({ empresa_id: e }, d), 'crear el cargo'); },
    guardar:function (id, d) { return editar('cargos', id, d, 'guardar el cargo'); },
  };

  var trabajadores = {
    listar: function () {
      return rest('trabajadores?select=*,trabajador_cargos(cargo_id),trabajador_sucursales(sucursal_id)'
                  + '&activo=eq.true&order=nombre', null, 'leer los trabajadores');
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
    guardar:function (id, d) { return editar('necesidades', id, d, 'guardar lo planificado'); },
    borrar: function (id) { return quitar('necesidades', 'id=eq.' + id, 'borrar lo planificado'); },
  };

  var asignaciones = {
    listar: function (s, a, b) { return delRango('asignaciones', s, a, b, 'leer las asignaciones'); },
    crear:  function (d) { return crear('asignaciones', d, 'guardar la asignación'); },
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

  window.DATOS = {
    auth: cuenta, yo: yo, primeraVez: primeraVez,
    sucursales: sucursales, cargos: cargos, trabajadores: trabajadores,
    horarios: horarios, necesidades: necesidades, asignaciones: asignaciones,
    turnos: turnos, anotar: anotar,
  };
})();
