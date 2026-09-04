# Cobro automático de Manoo Pro — guía de instalación (Stripe)

Todo esto es gratis de arrancar (Cloudflare Workers y Resend tienen plan
gratuito de sobra para este volumen; Stripe solo cobra comisión por venta,
no cuota fija). Son ~3 cuentas que **tienes que crear tú** — no puedo
hacerlo por ti porque piden tu identidad/banco — pero después de esto,
cada venta (y cada renovación anual) se procesa sola.

## 1. Stripe (cobrar)

1. Crea cuenta en stripe.com. Al activar pagos reales te van a pedir datos
   de tu negocio y tu CLABE (tu Banco Azteca funciona sin problema, Stripe
   paga en México vía SPEI a cualquier banco).
2. Developers → API keys → copia la **Secret key** (`sk_live_...`).
3. Guárdala en un lugar seguro — **no me la pases a mí**, va directo al
   Worker (paso 3).

## 2. Resend (enviar el correo con la licencia)

1. Crea cuenta gratis en resend.com (3,000 correos/mes gratis).
2. Genera una **API key**.
3. (Opcional pero recomendado para que no caiga en spam) Verifica un
   dominio propio para enviar — puedes usar `manoo.is-a.dev` una vez lo
   tengas. Mientras tanto funciona con su dominio de pruebas
   `onboarding@resend.dev`, solo que puede llegar a spam.

## 3. Cloudflare Workers (donde vive la automatización)

1. Crea cuenta gratis en cloudflare.com.
2. En esta máquina:
   ```bash
   cd ~/manoo/automation/worker
   npx wrangler login          # abre el navegador, autoriza con tu cuenta
   npx wrangler kv namespace create PROCESSED_PAYMENTS
   ```
   Copia el `id` que imprime y pégalo en `wrangler.toml` donde dice
   `REPLACE_WITH_KV_NAMESPACE_ID`.
3. Configura los secretos (cada comando pide que pegues el valor —
   nunca quedan en un archivo, nunca los veo yo):
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET   # lo obtienes en el paso 5
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put MANOO_PRIVATE_KEY_PEM   # pega el CONTENIDO de licensing/private-key.pem
   npx wrangler secret put SELLER_NOTIFY_EMAIL     # tu correo, para que te avisen de cada venta
   npx wrangler secret put EXPECTED_AMOUNT_CENTS   # el precio en centavos, ej: 2900 = $29.00
   ```
4. Despliega:
   ```bash
   npx wrangler deploy
   ```
   Esto te da una URL tipo `https://manoo-payments.TU-SUBDOMINIO.workers.dev`.

## 4. Crear el producto y el link de cobro

```bash
cd ~/manoo/automation
STRIPE_SECRET_KEY=sk_live_xxx node create-payment-link.mjs --price 2900 --name "Manoo Pro"
```

(Precio en centavos: 2900 = $29.00 USD/año. O créalo a mano en el Dashboard
de Stripe si prefieres clicks en vez de terminal.)

Copia la URL que imprime y reemplaza el `mailto:` del botón "Get Pro" en
`site/index.html` por esa URL.

## 5. Conectar el webhook

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**.
2. URL: `https://manoo-payments.TU-SUBDOMINIO.workers.dev/webhook/stripe`
3. Evento a escuchar: **`invoice.paid`** (cubre tanto la primera compra como
   cada renovación anual — un solo evento para todo).
4. Copia el **Signing secret** (`whsec_...`) que te da y ponlo con
   `wrangler secret put STRIPE_WEBHOOK_SECRET` (paso 3).
5. Usa el botón "Send test webhook" de Stripe con el evento `invoice.paid`
   para confirmar que tu Worker responde `200 ok` antes de anunciar nada.

## 6. Probar con dinero real (una vez)

Haz tú mismo una compra de prueba, confirma que:
- Te llega el correo con la licencia (a ti y al comprador)
- La licencia activa correctamente con `license_activate`
- No se duplica si Stripe reintenta el webhook

Después de eso, queda corriendo solo — incluyendo la renovación del año
que viene, sin que hagas nada.

## Notas de seguridad (por qué está diseñado así)

- La firma del webhook de Stripe está verificada con el algoritmo oficial
  documentado (HMAC-SHA256 de `timestamp.cuerpo`) — probado localmente
  antes de escribir esto, acepta firmas válidas y rechaza firmas
  manipuladas o con el secreto equivocado.
- Aun así, el Worker **nunca confía en el webhook por sí solo** — vuelve a
  preguntarle a la API de Stripe, con tu clave secreta, si la factura
  realmente está pagada y por el monto correcto.
- Cada evento se procesa una sola vez (idempotencia vía KV), aunque
  Stripe reintente la notificación.
- Tu llave privada de firma de licencias vive solo como secreto de
  Cloudflare — nunca en un archivo del repo, nunca la vi yo en texto
  plano fuera de tu máquina.
