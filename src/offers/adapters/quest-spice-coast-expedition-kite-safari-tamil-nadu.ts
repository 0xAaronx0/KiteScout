// ---------------------------------------------------------------------------
// Quest Adventure Sports Academy "Spice Coast Expedition", Tamil Nadu (India): the school's long guided kite safari, 14
// days of downwinding along the east coast of India "organised with a level of comfort" and "challenging", 15-30 km a
// day with a support vehicle on standby all day, nights in home stays and hotels, ending at "a world class kite spot".
// Sibling of the 5-day "Island Hopping" safari on the same page; data path, booking check (Checkfront has no kite
// category -> request only), liveness, photos and all parsers are documented in
// quest-island-hopping-kite-safari-rameswaram.ts, whose helpers this file imports.
//
// Kind 'tour'. Route: the page names no start, end or stops for this tour (unlike Island Hopping, which "starts & ends
//   in the city of Rameswaram"), so itinerarySpots stays empty and the pin is the operator's base, spot 'Rameswaram'
//   (inferred start; the school sits at Pirappanvalasai on the Gulf of Mannar, its home stay in Rameswaram).
// Slot: one undated slot "14 days ₹ 1,10,000" (Indian grouping = INR 110,000), priceUnit 'package', priceBasis
//   'person' (inferred), availability 'on_request'.
// Requests per run: 1 (the shared memoised /kitesurfing-tours page).
// ---------------------------------------------------------------------------
import type { OfferAdapter } from '../types.js';
import {
  QUEST_OPERATOR, QUEST_TOURS_URL, fetchQuestSlots, questContent, questPage, type QuestListing,
} from './quest-island-hopping-kite-safari-rameswaram.js';

const SPICE = /spice\s+coast/i;

export const QUEST_SPICE_COAST: QuestListing = {
  name: SPICE,
  title: 'Quest Spice Coast Expedition Kite Safari, Tamil Nadu',
  skillLevels: ['advanced'],
  lead: t => `Quest Adventure Sports Academy, a kite and watersports school on the Gulf of Mannar in Tamil Nadu, runs the Spice Coast Expedition, a challenging ${t.days}-day guided kite safari along the east coast of India that ends at a world-class kite spot, with nights in home stays and hotels; the page names no start point or stops, and the operator is based near Rameswaram.`,
};

export const questSpiceCoastExpeditionKiteSafariTamilNadu: OfferAdapter = {
  key: 'quest-spice-coast-expedition-kite-safari-tamil-nadu',
  name: 'Quest Adventure Sports Academy - Spice Coast Expedition Kite Safari (Tamil Nadu)',
  kind: 'tour',
  operator: QUEST_OPERATOR,
  url: QUEST_TOURS_URL,
  slotMethod: 'price_table',
  instantBooking: false, // e-mail / WhatsApp; the Checkfront engine has no kite category
  fetchBudget: 2,
  confidence: 'medium', // undated price, basis inferred, no route printed
  async fetchContent() {
    return questContent(await questPage(), QUEST_SPICE_COAST);
  },
  fetchSlots: ctx => fetchQuestSlots(SPICE, ctx),
};
