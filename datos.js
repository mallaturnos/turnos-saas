/* La capa de datos. Todo lo que habla con Supabase pasa por aqui y por ningun
   otro lado.

   POR QUE UNA CAPA Y NO LLAMADAS SUELTAS: en la malla, estampar el id del puesto
   en las asignaciones habria obligado a tocar DOCE sitios que creaban o editaban
   filas. Envolver la capa una vez los cubrio todos. «La mitad de los sitios» es
   como se cuelan los defectos, asi que aqui empezamos con la puerta unica.

   EL AISLAMIENTO ENTRE EMPRESAS NO SE HACE AQUI. Lo hace RLS en la base. Este
   archivo NO filtra por empresa_id al leer: si lo hiciera, bastaria una consulta
   olvidada para que una empresa viera datos de otra, y el dia que se olvide una
   nadie lo veria en pantalla. Al ESCRIBIR si se manda empresa_id, porque la fila
   nueva tiene que nacer con dueño. */
(function () {
  'use strict';

  var sb = null;

  /* Un almacen que no puede fallar.

     La biblioteca guarda la sesion en el navegador. Si el navegador lo tiene
     bloqueado —modo restringido, bloqueo de datos de sitio, algunas
     configuraciones de privacidad—, esas llamadas lanzan, y lanzando desde
     dentro de la biblioteca el resultado es una promesa que no vuelve nunca:
     la pantalla se queda esperando sin error.

     Con esto, si el navegador no deja guardar, la sesion vive en memoria. Se
     pierde al cerrar la pestaña —hay que volver a entrar—, que es infinitamente
     mejor que no poder entrar. */
  var enMemoria = {};
  var almacen = {
    getItem:    function (k) { try { return window.localStorage.getItem(k); }
                               catch (e) { return (k in enMemoria) ? enMemoria[k] : null; } },
    setItem:    function (k, v) { try { window.localStorage.setItem(k, v); }
                                  catch (e) { enMemoria[k] = v; } },
    removeItem: function (k) { try { window.localStorage.removeItem(k); }
                               catch (e) { delete enMemoria[k]; } },
  };

  function cliente() {
    if (sb) return sb;
    if (!window.CONFIG || window.CONFIG.SUPABASE_URL === 'PENDIENTE')
      throw new Error('Falta configurar el proyecto de Supabase en config.js.');
    sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON, {
      auth: {
        /* SIN CANDADO ENTRE PESTAÑAS.

           La biblioteca coordina el inicio de sesion entre pestañas con un
           candado compartido del navegador. Si una pestaña queda colgada con el
           candado tomado —o si el navegador no implementa bien esa API— TODAS
           las demas esperan para siempre: la pantalla se queda en «Entrando…»
           sin error, sin red, sin nada que mirar. Le paso a Pedro el 08-10 y no
           se reproducia en mi navegador.

           Lo que se pierde al quitarlo: si alguien tiene DOS pestañas abiertas y
           renueva la sesion en las dos a la vez, pueden pisarse. Es un caso raro
           y su peor consecuencia es tener que entrar de nuevo.
           Lo que se gana: que entrar funcione siempre. No es un intercambio
           dificil. */
        lock: function (nombre, espera, fn) { return fn(); },
        storage: almacen,
      },
    });
    return sb;
  }

  /* Un solo sitio donde se desenvuelve la respuesta de Supabase.
     El error se lanza con su texto: un `catch` que se traga el mensaje deja la
     pantalla en blanco sin decir por que, y eso ya costo medio dia en la malla. */
  /* Ninguna llamada puede quedarse colgada para siempre.

     Un error se ve y se arregla; un colgado silencioso se ve igual que algo
     lento, y la persona se queda mirando una pantalla que no va a cambiar
     nunca. Veinte segundos es mas de lo que cualquier consulta honesta demora.
     Esto NO arregla la causa: la convierte en algo que se puede leer. */
  function conTope(p, queHacia) {
    return Promise.race([
      p,
      new Promise(function (_, rechazar) {
        setTimeout(function () {
          rechazar(new Error('La base no contestó en 20 segundos (' + queHacia + '). '
            + 'Puede ser tu conexión o el proyecto despertando; vuelve a intentar.'));
        }, 20000);
      }),
    ]);
  }

  /* NINGUNA consulta puede colgarse en silencio, y cada una dice su nombre.

     El 08-10 la pantalla se quedo en «Cargando tus datos…» sin decir cual de
     las cuatro consultas no volvia. Con el nombre dentro del error, la proxima
     vez se sabe en el primer intento. */
  function pedir(p, que) {
    return conTope(p, que || 'consultar').then(function (r) {
      if (r.error) throw new Error(r.error.message || 'Error hablando con la base');
      return r.data;
    });
  }

  /* ¿Hay siquiera una sesion guardada?

     Mira el almacen DIRECTAMENTE, sin despertar a la biblioteca. Si no hay
     nada, no tiene sentido preguntarle: se va al login y listo.

     Por que importa: hasta el 08-10 la aplicacion llamaba a `getSession()` nada
     mas cargar, incluso para alguien que nunca ha entrado. Esa llamada deja a
     la biblioteca inicializada de una forma que —en el navegador de Pedro, no
     en el mio— hacia que el login posterior no volviera nunca. La pagina de
     prueba, que NO hacia esa llamada, entraba sin problemas con la misma cuenta
     y el mismo navegador: esa fue la diferencia que lo delato.

     Asi que no se pregunta cuando no hay nada que preguntar. Mas rapido para
     todos, y sin rodeos para quien recien llega. */
  function haySesionGuardada() {
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) return true;
      }
      return false;
    } catch (e) { return false; }   // sin acceso al almacen, no hay sesion guardada
  }

  // ---------- entrar y salir ----------
  var auth = {
    sesion:   function () {
      if (!haySesionGuardada()) return Promise.resolve(null);
      return cliente().auth.getSession().then(function (r) { return r.data.session; });
    },
    entrar:   function (email, clave) { return conTope(pedir(cliente().auth.signInWithPassword({ email: email, password: clave })), 'entrar'); },
    registrar:function (email, clave) { return conTope(pedir(cliente().auth.signUp({ email: email, password: clave })), 'crear la cuenta'); },
    salir:    function () { return cliente().auth.signOut(); },
    alCambiar:function (fn) { cliente().auth.onAuthStateChange(fn); },
  };

  // ---------- quien soy ----------
  // Devuelve null si el usuario entro pero todavia no tiene empresa: ese es el
  // caso de la primera vez, y la app lo manda a crearla.
  function yo() {
    return pedir(cliente().from('usuarios').select('*').maybeSingle(), 'buscar tu cuenta');
  }

  /* La primera vez: crear la empresa y quedar como dueño.

     VA POR UNA FUNCION EN LA BASE, no por dos inserciones desde aqui, y no es
     un capricho: una cuenta recien registrada no tiene fila en `usuarios`, asi
     que `mi_empresa()` devuelve NULL y las politicas de seguridad DENIEGAN las
     dos inserciones. Para escribir hay que tener empresa y para tener empresa
     hay que escribir — huevo y gallina.
     La funcion `crear_empresa` rompe el circulo haciendo las dos cosas de golpe
     y solo para quien la llama. Ver `arreglo-primera-vez.sql`.

     De paso deja de ser posible la empresa huerfana: dentro de la funcion las
     dos inserciones son UNA transaccion. */
  function primeraVez(nombreEmpresa) {
    return pedir(cliente().rpc('crear_empresa', { p_nombre: nombreEmpresa }));
  }

  // ---------- catalogos ----------
  var sucursales = {
    listar: function () { return pedir(cliente().from('sucursales').select('*').order('nombre'), 'leer los locales'); },
    crear:  function (empresaId, d) { return pedir(cliente().from('sucursales').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('sucursales').update(d).eq('id', id).select().single()); },
  };

  var cargos = {
    listar: function () { return pedir(cliente().from('cargos').select('*').eq('activo', true).order('nombre'), 'leer los cargos'); },
    crear:  function (empresaId, d) { return pedir(cliente().from('cargos').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('cargos').update(d).eq('id', id).select().single()); },
  };

  var trabajadores = {
    listar: function () {
      return pedir(cliente().from('trabajadores')
        .select('*, trabajador_cargos(cargo_id), trabajador_sucursales(sucursal_id)')
        .eq('activo', true).order('nombre'), 'leer los trabajadores');
    },
    crear:  function (empresaId, d) { return pedir(cliente().from('trabajadores').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('trabajadores').update(d).eq('id', id).select().single()); },
    ponerCargos: function (id, cargoIds) {
      var c = cliente();
      return pedir(c.from('trabajador_cargos').delete().eq('trabajador_id', id)).then(function () {
        if (!cargoIds.length) return [];
        return pedir(c.from('trabajador_cargos').insert(
          cargoIds.map(function (q) { return { trabajador_id: id, cargo_id: q }; })));
      });
    },
    ponerSucursales: function (id, sucIds) {
      var c = cliente();
      return pedir(c.from('trabajador_sucursales').delete().eq('trabajador_id', id)).then(function () {
        if (!sucIds.length) return [];
        return pedir(c.from('trabajador_sucursales').insert(
          sucIds.map(function (s) { return { trabajador_id: id, sucursal_id: s }; })));
      });
    },
  };

  var horarios = {
    listar: function () { return pedir(cliente().from('horarios').select('*').order('hora_inicio'), 'leer los horarios'); },
    crear:  function (empresaId, d) { return pedir(cliente().from('horarios').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    borrar: function (id) { return pedir(cliente().from('horarios').delete().eq('id', id)); },
  };

  // ---------- el nucleo ----------
  var necesidades = {
    listar: function (sucursalId, desde, hasta) {
      return pedir(cliente().from('necesidades').select('*')
        .eq('sucursal_id', sucursalId).gte('fecha', desde).lte('fecha', hasta)
        .order('fecha').order('hora_inicio'));
    },
    crear:  function (d) { return pedir(cliente().from('necesidades').insert(d).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('necesidades').update(d).eq('id', id).select().single()); },
    borrar: function (id) { return pedir(cliente().from('necesidades').delete().eq('id', id)); },
  };

  var asignaciones = {
    listar: function (sucursalId, desde, hasta) {
      return pedir(cliente().from('asignaciones').select('*')
        .eq('sucursal_id', sucursalId).gte('fecha', desde).lte('fecha', hasta)
        .order('fecha').order('hora_inicio'));
    },
    crear:  function (d) { return pedir(cliente().from('asignaciones').insert(d).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('asignaciones').update(d).eq('id', id).select().single()); },
    borrar: function (id) { return pedir(cliente().from('asignaciones').delete().eq('id', id)); },
  };

  var turnos = {
    listar: function (sucursalId, desde, hasta) {
      return pedir(cliente().from('turnos').select('*')
        .eq('sucursal_id', sucursalId).gte('fecha', desde).lte('fecha', hasta)
        .order('fecha').order('hora_inicio'));
    },
    // Lo que ve el trabajador: SOLO lo publicado. El borrador no sale de aqui.
    mios: function (trabajadorId, desde, hasta) {
      return pedir(cliente().from('turnos').select('*')
        .eq('trabajador_id', trabajadorId).eq('estado', 'publicado')
        .gte('fecha', desde).lte('fecha', hasta)
        .order('fecha').order('hora_inicio'));
    },
    crearLote: function (filas) { return pedir(cliente().from('turnos').insert(filas).select()); },
    guardar:   function (id, d) { return pedir(cliente().from('turnos').update(d).eq('id', id).select().single()); },
    borrarDe:  function (asignacionIds) { return pedir(cliente().from('turnos').delete().in('asignacion_id', asignacionIds)); },
  };

  // ---------- auditoria ----------
  /* Se graba desde el primer dia. No es prolijidad: «quien cambio este turno»
     no se puede reconstruir despues, y en un producto donde se discute un sueldo
     es lo primero que piden.
     Si falla, NO se cae la operacion: se avisa por consola. Perder el rastro de
     un cambio es malo; impedir que la persona trabaje porque el rastro fallo es
     peor. */
  function anotar(empresaId, usuarioId, entidad, entidadId, accion, antes, despues) {
    return pedir(cliente().from('eventos').insert({
      empresa_id: empresaId, usuario_id: usuarioId, entidad: entidad,
      entidad_id: entidadId || null, accion: accion,
      antes: antes || null, despues: despues || null
    })).catch(function (e) { console.warn('no se pudo anotar el evento:', e.message); });
  }

  window.DATOS = {
    auth: auth, yo: yo, primeraVez: primeraVez,
    sucursales: sucursales, cargos: cargos, trabajadores: trabajadores,
    horarios: horarios, necesidades: necesidades, asignaciones: asignaciones,
    turnos: turnos, anotar: anotar,
  };
})();
