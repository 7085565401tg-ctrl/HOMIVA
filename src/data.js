export function formatMoney(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return 'Not provided';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

export function estimatedMonthly(home) {
  if (home.maintenance === null || home.maintenance === undefined || home.utilities === null || home.utilities === undefined) return null;
  return Number(home.price || 0) + Number(home.maintenance || 0) + Number(home.utilities || 0);
}

export function parseSearchIntent(query) {
  const text = String(query || '').trim();
  const budgetMatch = text.match(/(?:under|below|less than|up to|upto|max(?:imum)?|budget(?: of)?)\s*₹?\s*([\d,]+)/i)
    || text.match(/₹\s*([\d,]+)/i);
  const roomMatch = text.match(/\b(\d+)\s*(?:bed(?:room)?s?|bhk)\b/i);
  const knownPlaces = ['Baner', 'Aundh', 'Wakad', 'Kothrud', 'Viman Nagar', 'Pashan'];
  const foundPlace = knownPlaces.find((place) => text.toLowerCase().includes(place.toLowerCase()));
  const city = /\bpune\b/i.test(text) ? 'Pune' : '';
  const furnishing = /\bunfurnished\b/i.test(text) ? 'Unfurnished' : /semi[\s-]*furnished/i.test(text) ? 'Semi-furnished' : /furnish(?:ed)?/i.test(text) ? 'Furnished' : '';
  return {
    maxBudget: budgetMatch ? Number(budgetMatch[1].replaceAll(',', '')) : '',
    bedrooms: roomMatch ? Number(roomMatch[1]) : '',
    furnishing,
    parking: /\bparking\b|\bpark\b/i.test(text),
    place: foundPlace || '',
    city
  };
}

export function monthlyFromHome(home) {
  const total = estimatedMonthly(home);
  return total === null ? 'Ask owner for total' : formatMoney(total);
}
