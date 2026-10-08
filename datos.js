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

  function cliente() {
    if (sb) return sb;
    if (!window.CONFIG || window.CONFIG.SUPABASE_URL === 'PENDIENTE')
      throw new Error('Falta configurar el proyecto de Supabase en config.js.');
    sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON);
    return sb;
  }

  /* Un solo sitio donde se desenvuelve la respuesta de Supabase.
     El error se lanza con su texto: un `catch` que se traga el mensaje deja la
     pantalla en blanco sin decir por que, y eso ya costo medio dia en la malla. */
  function pedir(p) {
    return p.then(function (r) {
      if (r.error) throw new Error(r.error.message || 'Error hablando con la base');
      return r.data;
    });
  }

  // ---------- entrar y salir ----------
  var auth = {
    sesion:   function () { return cliente().auth.getSession().then(function (r) { return r.data.session; }); },
    entrar:   function (email, clave) { return pedir(cliente().auth.signInWithPassword({ email: email, password: clave })); },
    registrar:function (email, clave) { return pedir(cliente().auth.signUp({ email: email, password: clave })); },
    salir:    function () { return cliente().auth.signOut(); },
    alCambiar:function (fn) { cliente().auth.onAuthStateChange(fn); },
  };

  // ---------- quien soy ----------
  // Devuelve null si el usuario entro pero todavia no tiene empresa: ese es el
  // caso de la primera vez, y la app lo manda a crearla.
  function yo() {
    return pedir(cliente().from('usuarios').select('*').maybeSingle());
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
    listar: function () { return pedir(cliente().from('sucursales').select('*').order('nombre')); },
    crear:  function (empresaId, d) { return pedir(cliente().from('sucursales').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('sucursales').update(d).eq('id', id).select().single()); },
  };

  var cargos = {
    listar: function () { return pedir(cliente().from('cargos').select('*').eq('activo', true).order('nombre')); },
    crear:  function (empresaId, d) { return pedir(cliente().from('cargos').insert(Object.assign({ empresa_id: empresaId }, d)).select().single()); },
    guardar:function (id, d) { return pedir(cliente().from('cargos').update(d).eq('id', id).select().single()); },
  };

  var trabajadores = {
    listar: function () {
      return pedir(cliente().from('trabajadores')
        .select('*, trabajador_cargos(cargo_id), trabajador_sucursales(sucursal_id)')
        .eq('activo', true).order('nombre'));
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
    listar: function () { return pedir(cliente().from('horarios').select('*').order('hora_inicio')); },
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
