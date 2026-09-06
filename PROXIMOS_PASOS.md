# Estado de venta de Manoo

*Actualizado 2026-09-06 — reemplaza el plan original de 2026-09-04, que ya
se completó casi por entero.*

## ✅ Ya vendiendo — 100% en vivo, cobro automático funcionando

- **Sitio público en vivo:** [jamielgv.github.io/manoo](https://jamielgv.github.io/manoo/)
  — bilingüe (ES/EN), precios reales, botón "Obtener Pro" con toggle
  Anual/Mensual.
- **Cobro real con Stripe:** cuenta activada (identidad, banco, 2FA) en
  modo real. Dos links de pago reales conectados en el sitio:
  - Anual $49 USD/año
  - Mensual $6 USD/mes
- **Emisión automática de licencia:** Cloudflare Worker
  (`manoo-payments.corporacionjamiel.workers.dev`) recibe el webhook
  `invoice.paid` de Stripe, **re-verifica el pago directo con la API de
  Stripe** (nunca confía solo en el webhook), emite la licencia firmada
  Ed25519 con la duración correcta según el plan comprado, y manda el
  correo — todo sin que nadie toque nada por venta.
- **Producto funcionando:** Free (25 acciones/sesión) + Pro (ilimitado +
  audit log). Split-screen automático + cursor neón mientras Manoo actúa.
  Plugin público en GitHub: [github.com/JamielGV/manoo](https://github.com/JamielGV/manoo).
- **Legal (borradores, no publicados aún):** `LEGAL_TERMINOS_DE_SERVICIO.md`
  y `LEGAL_AVISO_DE_PRIVACIDAD.md` existen pero **todavía no están
  enlazados desde el sitio** — ver pendientes abajo.

## 🟡 Pendiente real (nada de esto bloquea vender, pero conviene cerrar pronto)

1. **Hacer una compra de prueba real** (aunque sea el plan de $6/mes) para
   confirmar que todo el flujo automático funciona de punta a punta con
   dinero de verdad — revisar `npx wrangler tail` en
   `automation/worker/` durante la prueba.
2. **Enlazar ToS/Aviso de Privacidad desde `site/index.html`** — los
   borradores ya existen, solo falta el link en el pie de página.
3. **Reservar `manoo.is-a.dev`** — requiere que TÚ hagas el PR (ese
   proyecto pide explícitamente que no sea generado por IA).
4. **Registro de marca ante IMPI** — conviene no tardar mucho por ser
   "primero en presentar", pero no impide vender mientras se tramita.

## 🔴 Esto sí cuesta dinero (cuando quieras dar el siguiente salto)

- Dominio propio `manoo.ai` (~$160 USD por 2 años) — no urgente,
  `is-a.dev` cubre mientras tanto, y el checkout ya funciona sin él.
- Registro de marca ante IMPI (~$5,600 MXN de tarifas + opcional
  búsqueda/agente).

## Conseguir clientes (sigue siendo lo único que realmente falta)

El producto y el cobro ya están resueltos — lo que mueve la aguja ahora
es que la gente se entere:

1. Avisar a contactos directos que les sirva automatizar tareas
   repetitivas (agencias, freelancers, dev shops).
2. Un post corto donde ya haya gente usando Claude Code (r/ClaudeAI,
   r/learnprogramming, X/Twitter, dev.to) — ver `LANZAMIENTO_POSTS.md`
   para los textos ya escritos en español e inglés. Un GIF corto del
   cursor neón + split-screen en acción funciona mejor que texto solo.

## Decisiones ya tomadas

- Precio de Manoo Pro: **$49 USD/año** u **$6 USD/mes** — fijado tras
  revisar precios de la competencia (agentes de escritorio comparables
  cobran $20-79/mes por tener servidor propio; Manoo corre 100% local).
- Procesador de pago: **Stripe** (no Lemon Squeezy/Mercado Pago) — pago
  directo a Banco Azteca vía SPEI, con un principio de diseño explícito:
  ningún secreto de pago pasa nunca por Claude, todo va directo de la
  terminal del usuario a los secretos de Cloudflare
  (`automation/SETUP.md`).
- Solicitante de la marca ante IMPI: **Jamiel García Velázquez, persona
  física** — "Corporación Jamiel" es nombre comercial, no una persona
  moral registrada — ver `TRADEMARK_IMPI_BORRADOR.md`.
- Usuario de GitHub: **JamielGV** — el plugin ya está público ahí.
