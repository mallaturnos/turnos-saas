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
    sucursales: sucursales, cargos: cargos, trabajadores: trabajadores, eventos: eventos,
    plantillas: plantillas, ausencias: ausencias,
    horarios: horarios, necesidades: necesidades, asignaciones: asignaciones,
    turnos: turnos, anotar: anotar,
  };
})();
