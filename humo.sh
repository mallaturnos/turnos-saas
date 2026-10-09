#!/usr/bin/env bash
# Prueba de humo: abre la app DE VERDAD con datos inventados y aprieta los botones.
#
#   bash pruebas/humo.sh
#
# POR QUE EXISTE: el 08-10, al publicar la primera versión, tuve que decirle a
# Pedro que no había podido recorrer el flujo completo —para eso haría falta una
# cuenta dentro de su proyecto—. Entregar sin recorrerlo es publicar a medias, y
# en la malla eso salió caro: un cambio dejó todos los botones muertos y lo
# encontró él en dos minutos.
#
# `demo.html` carga `app.js` SIN TOCARLE UNA LÍNEA, con `demo_datos.js` en lugar
# de la base. Así se puede mirar y, sobre todo, APRETAR antes de publicar.
#
# LO QUE ESTO NO PRUEBA, y conviene saberlo para no creerse más seguro de lo que
# uno está: las políticas de seguridad de la base, los índices únicos de verdad
# (aquí se imitan) y que el SQL esté bien escrito. Para eso no hay atajo: hay que
# correrlo en Postgres.
set -u
cd "$(dirname "$0")/.."

# La demo se REGENERA aquí, siempre. Si dependiera de que alguien se acuerde de
# ejecutar el generador, el día que cambie la pantalla estas pruebas pasarían
# verdes sobre una copia vieja — probando una aplicación que ya no existe.
python3 generar_demo.py || { echo "No pude generar demo.html"; exit 2; }

# Una corrida a la vez: dos comparten el mismo Chrome y se pisan la página.
LOCK=/tmp/humo-turnos-saas.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Ya hay otra corrida en marcha ($LOCK). Espera a que termine."
  exit 2
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

ok=0; mal=0
mira() { # nombre, expresión JS, esperado
  local got; got=$(agent-browser eval "$2" 2>/dev/null | tail -1 | tr -d '"\\')
  if [ "$got" = "$3" ]; then ok=$((ok+1)); echo "  ok  · $1";
  else mal=$((mal+1)); echo "  MAL · $1 — esperaba '$3' y fue '$got'"; fi
}
aprieta() { agent-browser eval "$1" >/dev/null 2>&1; sleep 0.8; }

agent-browser open "file://$PWD/demo.html" >/dev/null 2>&1
sleep 2
# Los errores de JavaScript se juntan desde el principio: una pantalla que se
# dibuja a medias se ve «casi bien» y pasa inadvertida.
aprieta "window.__err=[]; window.addEventListener('error',function(e){window.__err.push(String(e.message))}); 'listo'"

echo
echo "— la app arranca —"
# ⚠ SE PREGUNTA POR EL ESTILO CALCULADO, NO POR EL ATRIBUTO.
#
# El 08-10 esta misma comprobacion existia escrita como `.hidden` y daba verde
# mientras la pantalla de entrada seguia dibujada ENCIMA de la aplicacion: el
# atributo decia «oculto» y una regla CSS con `display` lo pisaba. Pedro paso la
# tarde mirando un formulario con la app cargada detras, y a mi el codigo me
# decia que todo estaba bien.
#
# `elemento.hidden` mide la INTENCION. `getComputedStyle(el).display` mide el
# RESULTADO. En una prueba de interfaz solo vale el segundo.
mira "la pantalla de entrada NO se dibuja cuando se entra" \
     "getComputedStyle(document.querySelector('#p-entrar')).display" "none"
mira "y la app SI se dibuja" \
     "getComputedStyle(document.querySelector('#app')).display" "block"
mira "entra solo y muestra la app, no el login" \
     "document.querySelector('#app').hidden ? 'login' : 'app'" "app"
mira "la semana se dibuja con sus siete días" \
     "String(document.querySelectorAll('#malla .dia').length)" "7"

echo
echo "— la cobertura se calcula, no se guarda —"
# n1 pide 2 de cocina y tiene 2 asignaciones, pero UNA está pendiente: cubre 1.
mira "una necesidad con alguien pendiente dice que falta gente" \
     "(function(){var c=document.querySelector('[data-nec=\"n1\"] .cobertura');
       return c?c.textContent:'no está';})()" "Falta 1"
mira "y la que está cubierta de verdad dice Completo" \
     "(function(){var c=document.querySelector('[data-nec=\"n4\"] .cobertura');
       return c?c.textContent:'no está';})()" "Completo"

echo
echo "— lo que Pedro pidió que se pudiera hacer —"
mira "se puede dejar a alguien PENDIENTE y se ve como tal" \
     "(function(){var l=document.querySelector('[data-asigid=\"a2\"]');
       if(!l) return 'no está';
       return l.classList.contains('pendiente') && /^pendiente/.test(l.textContent)
         ? 'pendiente' : 'sale como '+l.textContent;})()" "pendiente"
mira "se puede cubrir SOLO UN TROZO del horario" \
     "(function(){var l=document.querySelector('[data-asigid=\"a3\"]');
       return l? l.querySelector('.hs').textContent.replace(/\\s+/g,' ').trim() : 'no está';})()" \
     "17:00–20:00 3:00"
# El contador de horas lo pidio Pedro el 09-10 («si un trabajador parte a las
# 8:00 a las 12:00 deberia aparecer 4:00»). Se comprueba aqui y no solo con la
# vista: es el unico sitio que falla si alguien pinta un par de horas a mano en
# vez de usar rangoHtml(), que es justo lo que hay que impedir.
mira "las horas vienen con su contador" \
     "(function(){var l=document.querySelector('[data-asigid=\"a1\"]');
       var t=l?l.querySelector('.hs').textContent.replace(/\\s+/g,' ').trim():'no está';
       return /\\d{2}:\\d{2}–\\d{2}:\\d{2} \\d+:\\d{2}/.test(t)? 'con contador' : 'SIN contador: '+t;})()" \
     "con contador"
mira "un turno sin nada planificado sale marcado «sin planificar»" \
     "(function(){var s=document.querySelectorAll('.nec.suelta .cobertura');
       return s.length? s[0].textContent : 'no hay sueltas';})()" "sin planificar"

echo
echo "— los cargos AVISAN, no bloquean —"
aprieta "(function(){__app.abrirAsignacion(null,'n1',null);
   var s=document.querySelector('#aQuien'); s.value='t1';
   s.dispatchEvent(new Event('change')); return 'listo';})()"
mira "asignar a alguien sin ese cargo avisa" \
     "document.querySelector('#aOjo').hidden ? 'no avisa' : 'avisa'" "avisa"
mira "y aun así deja guardar" \
     "document.querySelector('#aGuardar').disabled ? 'bloqueado' : 'deja'" "deja"
aprieta "document.querySelector('#dlgAsig').close(); 'listo'"

echo
echo "— publicar: lo importante es que NO duplique —"
aprieta "document.querySelector('#btnPublicar').click()"
mira "publica los que tienen persona, no los pendientes" \
     "String(window.__BD.turnos.length)" "4"
aprieta "document.querySelector('#btnPublicar').click()"
mira "y apretarlo DE NUEVO no duplica nada" \
     "String(window.__BD.turnos.length)" "4"
mira "los publicados se marcan en la malla" \
     "String(document.querySelectorAll('#malla .gente li.publicado').length)" "4"

echo
echo "— el trabajador ve solo lo publicado —"
aprieta "(function(){document.querySelector('[data-p=\"mio\"]').click(); return 'listo';})()"
mira "mis turnos salen y son los míos" \
     "String(document.querySelectorAll('#t-mio .item').length)" "1"
aprieta "(function(){document.querySelector('[data-p=\"plan\"]').click(); return 'listo';})()"

echo
echo "— borrar lo planificado no borra a la gente —"
# Es el error que haría desaparecer personas de la malla sin que nadie lo note.
aprieta "(function(){window.confirm=function(){return true};
   abrirNecesidad(S_nec('n2')); document.querySelector('#nBorrar').click(); return 'listo';})()"
mira "la gente de una necesidad borrada queda «sin planificar», no desaparece" \
     "String(window.__BD.asignaciones.filter(function(a){return a.id==='a3'}).length)" "1"

echo
echo "— el catálogo de cargos no se duplica —"
aprieta "(function(){__app.abrirFicha('cargo',null);
   document.querySelector('#fNombre').value='cocina';
   document.querySelector('#fGuardar').click(); return 'listo';})()"
mira "«cocina» y «Cocina» son el mismo cargo y avisa" \
     "/Ya tienes un cargo/.test(document.querySelector('#fMsg').textContent) ? 'avisa' : 'lo dejó pasar'" "avisa"
aprieta "document.querySelector('#dlgFicha').close(); 'listo'"

echo
mira "ningún error de JavaScript en todo el recorrido" \
     "String((window.__err||[]).length)" "0"

agent-browser close --all >/dev/null 2>&1
echo
echo "$ok bien · $mal mal"
echo
[ "$mal" -eq 0 ]
