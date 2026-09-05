# Próximos pasos para vender Manoo

## 🚀 Plan para vender pronto (hecho 2026-09-04)

Tres pistas en paralelo — no hay que esperar a que una termine para
empezar la siguiente. Nada de esto bloquea vender: **ya puedes vender hoy
mismo de forma manual** (ver sección de abajo), así que la pista de
clientes empieza ya, no al final.

**Pista 1 — Conseguir clientes (empieza HOY, no esperes a nada más)**
1. Hoy: avisa a 5-10 contactos que ya conozcas y que les sirva automatizar
   tareas repetitivas en su compu (agencias, freelancers, dev shops) —
   véndeles manual (sección 🟢 abajo). No necesitas la página ni Stripe
   para esto.
2. Esta semana: un post corto en un lugar donde ya haya gente usando
   Claude Code (comunidad/Discord de Claude Code, r/ClaudeAI, X/Twitter)
   mostrando Manoo en acción — un GIF corto del cursor neón + split-screen
   funciona mejor que texto. Dime cuando quieras y te preparo el clip/post.

**Pista 2 — Quitar la fricción para pagar (esta semana, casi todo gratis)**
1. Publicar `site/index.html` en GitHub Pages — el repo ya es público,
   solo falta activarlo en Settings → Pages. **Esto lo puedo hacer yo
   ahora mismo** si me dices que sí (entro con el navegador ya logueado).
2. Crear cuenta Stripe + Resend + Cloudflare (~30-40 min, gratis) siguiendo
   `automation/SETUP.md` — una vez existan, corro
   `automation/create-payment-link.mjs` y despliego el Worker, y el botón
   "Get Pro" de la página pasa de mandarte un correo a cobrar solo.
3. Reservar `manoo.is-a.dev` — requiere que TÚ hagas el PR (ese proyecto
   pide explícitamente que no sea generado por IA); yo ya te dejé la
   plantilla lista.

**Pista 3 — Lo legal/marca (en paralelo, no bloquea vender)**
- Registro de marca IMPI: conviene no tardar mucho por ser "primero en
  presentar", pero no impide vender mientras se tramita.
- Dominio propio (`manoo.ai`): no urgente, `is-a.dev` cubre mientras tanto.

**Orden sugerido de esta semana:** día 1 (hoy) = primeros contactos +
autorizas GitHub Pages. Día 2-3 = cuentas Stripe/Resend/Cloudflare. Día
3-4 = Payment Link activo + primer post público. De ahí en adelante,
vender es repetir la Pista 1 con más alcance.

## ✅ Ya hecho (gratis, listo)

- Producto funcionando: Free (25 acciones/sesión) + Pro (ilimitado + audit log), con licencias firmadas Ed25519.
- Split-screen automático con el IDE (para que siempre veas a Claude Code mientras Manoo actúa) + cursor neón que muestra que Manoo está trabajando.
- Página de aterrizaje con precios (`site/index.html`) — Free $0, Pro $49 USD/año o $6 USD/mes (actualizado tras análisis de mercado).
- Términos de Servicio (`LEGAL_TERMINOS_DE_SERVICIO.md`) y Aviso de Privacidad (`LEGAL_AVISO_DE_PRIVACIDAD.md`) — borradores funcionales.
- Logo real de Corporación Jamiel integrado.
- Investigación de dominio (`manoo.ai`/`manoo.dev` libres) y marca (borrador de clases 9/42 para IMPI).
- **Plugin público en GitHub:** [github.com/JamielGV/manoo](https://github.com/JamielGV/manoo).

## 🟢 Puedes vender HOY mismo, sin nada más (manual)

1. Alguien te contacta (por ahora, el botón "Get Pro" manda un correo a tu Gmail).
2. Te paga como puedas cobrar ahora mismo (transferencia, efectivo, Mercado Pago personal).
3. Corres: `node ~/manoo/licensing/mint-license.mjs --email correo@cliente.com --plan pro --days 365`
4. Le mandas la clave que imprime, y le dices que la active con `license_activate` en Claude Code.

Cero código nuevo necesario para tu primera venta.

## 🤖 Cobro 100% automático (ya construido, falta que crees las cuentas)

`~/manoo/automation/` — Cloudflare Worker que recibe el pago de **Stripe**
(cambiado de Mercado Pago por tu preferencia), lo re-verifica directo con
la API de Stripe (nunca confía en el webhook solo), emite la licencia, y
manda el correo — sin que tú toques nada por venta. También renueva la
licencia solo cada año, sin intervención.

Probado de verdad: el bundle compila limpio, la firma de licencia que
genera es 100% compatible con el plugin ya instalado, y la verificación
de firma del webhook de Stripe está probada localmente (acepta válidas,
rechaza manipuladas) — a diferencia de Mercado Pago, el formato de Stripe
sí está 100% documentado, no hay incertidumbre aquí.

Necesitas crear (gratis, ~30-40 min la primera vez): cuenta Stripe, cuenta
Resend, cuenta Cloudflare. Guía paso a paso completa en
`automation/SETUP.md` — está diseñada para que nunca me pases tus tokens
a mí, van directo de tu terminal a los secretos de Cloudflare. Tu Banco
Azteca funciona sin problema para recibir los pagos (Stripe paga en
México vía SPEI a cualquier banco).

## 🟡 Gratis pero requiere que TÚ lo hagas (necesita tu cuenta/identidad)

En orden de impacto:

1. **Publicar la página** en GitHub Pages (`site/index.html` ya está lista, y el repo ya es público) — solo falta activarlo en Settings → Pages del repo.
2. **Reservar `manoo.is-a.dev`** — plantilla y pasos ya te los di, solo falta que hagas el PR con tu cuenta.
3. **Crear cuenta de Stripe** (y Resend + Cloudflare) para el cobro 100% automático — ver sección de abajo y `automation/SETUP.md`.

## 🔴 Esto sí cuesta dinero (cuando quieras dar el siguiente salto)

- Dominio `manoo.ai` (~$160 USD por 2 años) — no urgente, is-a.dev cubre mientras tanto.
- Registro de marca ante IMPI (~$5,600 MXN de tarifas + opcional búsqueda/agente) — sí conviene no tardar mucho por ser "primero en presentar".
- Procesador de pago automatizado tipo Lemon Squeezy/Paddle (comisión por venta, no costo fijo) — para cuando el volumen ya no aguante el flujo manual.

## Decisiones ya tomadas (por mí, a tu pedido)

- Precio de Manoo Pro: **$49 USD/año** (o $6 USD/mes) — actualizado tras revisar precios de la competencia (agentes de escritorio comparables cobran $20-79/mes por tener servidor propio).
- Solicitante de la marca ante IMPI: **Jamiel García Velázquez, persona física** — "Corporación Jamiel" es nombre comercial, no una persona moral registrada — ver `TRADEMARK_IMPI_BORRADOR.md`.
- Usuario de GitHub: **JamielGV** — el plugin ya está público ahí.
