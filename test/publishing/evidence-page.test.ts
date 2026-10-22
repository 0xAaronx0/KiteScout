import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageZones } from '../../src/publishing/evidence-page.js';

// Shape of every UCPA product page (AMP): the "not for sale" / "sold out" states ship as hidden blocks
// that amp-bind only reveals in that state, next to the live price and calendar.
const UCPA = `<!doctype html><html lang="fr"><head><title>Kitesurf spécial débutant - Hurghada | UCPA</title>
<script type="application/ld+json">{"@type":"Product","name":"Kitesurf spécial débutant","offers":{"price":"1101","priceCurrency":"EUR"}}</script></head>
<body><h1>Kitesurf spécial débutant</h1>
<div class="flex"><div data-amp-bind-hidden="reserve.noOffersState != 'closed_to_sale'" hidden="hidden">Ce séjour n'est plus proposé à la vente</div>
<div data-amp-bind-hidden=" reserve.noOffersState != 'complete'" hidden="hidden" class="bold"><span>Bouhhh... C’est complet !</span></div></div>
<p>À partir de <span>801 €</span> par personne, 51 dates disponibles.</p>
<span hidden="hidden" data-amp-bind-hidden="(!reserve.offerSelected)">** Le prix du transport vous sera confirmé 72h après la réservation</span>
<template type="amp-mustache"><div>{{price}} € le {{date}}</div></template>
</body></html>`;

test('evidence page: hidden blocks (UCPA "plus proposé à la vente") are not in the visible zone', () => {
  const z = pageZones(UCPA);
  assert.doesNotMatch(z.visible, /plus proposé à la vente/);
  assert.doesNotMatch(z.visible, /complet/);
  assert.doesNotMatch(z.visible, /prix du transport/);
  assert.doesNotMatch(z.visible, /\{\{price\}\}/, '<template> content stays out too');
  assert.match(z.visible, /Kitesurf spécial débutant À partir de 801 € par personne, 51 dates disponibles\./);
  // meta and JSON-LD are separate zones and do not depend on the DOM around them
  assert.match(z.meta, /Hurghada \| UCPA/);
  assert.match(z.jsonld, /"price":"1101"/);
});

test('evidence page: every hidden attribute form hides, nested ones included', () => {
  const z = pageZones('<body><p>shown one</p><div hidden>a<div hidden="">b</div></div><SPAN HIDDEN>c</SPAN>'
    + '<div hidden="false">elementor writes this; browsers still hide it</div><img hidden src="x.jpg"><p>shown two</p></body>');
  assert.equal(z.visible, 'shown one shown two');
});

test('evidence page: content one click away, aria-hidden and inline display:none stay', () => {
  const z = pageZones('<body>'
    + '<div role="tabpanel" hidden="hidden">13 nights accommodation in a double room</div>'
    + '<div hidden="until-found">Day 3: downwinder</div>'
    + '<div hidden id="S:0">Course and stay in Mayapo</div><script>$RC("B:0","S:0")</script>'
    + '<span aria-hidden="true">7 nights</span>'
    + '<div class="rev_slider" style="display:none">Kite resort in Sicily</div>'
    + '<script>var t = "<div hidden>not markup</div>";</script></body>');
  assert.equal(z.visible, '13 nights accommodation in a double room Day 3: downwinder Course and stay in Mayapo 7 nights Kite resort in Sicily');
});
