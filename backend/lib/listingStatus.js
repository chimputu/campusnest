// Call only inside a transaction that already holds FOR UPDATE on the listing row.
async function recomputeListingStatus(client, listingId) {
  const { rows } = await client.query(
    `SELECT l.status, l.total_beds,
            (SELECT COUNT(*)::int FROM requests r
               WHERE r.listing_id = l.id AND r.status = 'ACCEPTED') AS occupied
       FROM listings l WHERE l.id = $1`,
    [listingId]
  );
  if (!rows[0]) return null;
  const { status, total_beds, occupied } = rows[0];
  let next = status;
  if (status === 'FULL' && occupied < total_beds) next = 'ACTIVE';
  if (status === 'ACTIVE' && occupied >= total_beds) next = 'FULL';
  if (next !== status) {
    await client.query('UPDATE listings SET status = $1 WHERE id = $2', [next, listingId]);
  }
  return { status: next, occupied };
}

// Lock order for every request transition: listing row first, then the request row.
async function lockListing(client, listingId) {
  const { rows } = await client.query('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [listingId]);
  return rows[0] || null;
}

module.exports = { recomputeListingStatus, lockListing };
