import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createTestClient } from './prisma-sqlite-test-client.ts';

type Client = Awaited<ReturnType<typeof createTestClient>>;

// Canonical Chinook seed counts. Used as sanity checks throughout.
const COUNTS = {
  Album: 347,
  Artist: 275,
  Customer: 59,
  Employee: 8,
  Genre: 25,
  Invoice: 412,
  InvoiceLine: 2240,
  MediaType: 5,
  Playlist: 18,
  PlaylistTrack: 8715,
  Track: 3503,
} as const;

describe('prisma chinook integration', () => {
  let prisma: Client;

  beforeEach(async () => {
    prisma = await createTestClient();
  });

  describe('basic CRUD', () => {
    it('counts seed rows for every model', async () => {
      assert.equal(await prisma.album.count(), COUNTS.Album);
      assert.equal(await prisma.artist.count(), COUNTS.Artist);
      assert.equal(await prisma.customer.count(), COUNTS.Customer);
      assert.equal(await prisma.employee.count(), COUNTS.Employee);
      assert.equal(await prisma.genre.count(), COUNTS.Genre);
      assert.equal(await prisma.invoice.count(), COUNTS.Invoice);
      assert.equal(await prisma.invoiceLine.count(), COUNTS.InvoiceLine);
      assert.equal(await prisma.mediaType.count(), COUNTS.MediaType);
      assert.equal(await prisma.playlist.count(), COUNTS.Playlist);
      assert.equal(await prisma.playlistTrack.count(), COUNTS.PlaylistTrack);
      assert.equal(await prisma.track.count(), COUNTS.Track);
    });

    it('reads an existing row by primary key', async () => {
      const artist = await prisma.artist.findUnique({ where: { artistId: 1 } });
      assert.ok(artist);
      assert.equal(artist.name, 'AC/DC');
    });

    it('returns null for a missing row', async () => {
      const artist = await prisma.artist.findUnique({
        where: { artistId: 99999 },
      });
      assert.equal(artist, null);
    });

    it('throws when findUniqueOrThrow misses', async () => {
      await assert.rejects(
        prisma.artist.findUniqueOrThrow({ where: { artistId: 99999 } }),
      );
    });

    it('creates, reads, updates, and deletes a row', async () => {
      const created = await prisma.genre.create({
        data: { name: 'Synthwave' },
      });
      assert.equal(created.name, 'Synthwave');
      assert.ok(created.genreId > 25);

      const read = await prisma.genre.findUnique({
        where: { genreId: created.genreId },
      });
      assert.equal(read?.name, 'Synthwave');

      const updated = await prisma.genre.update({
        where: { genreId: created.genreId },
        data: { name: 'Vaporwave' },
      });
      assert.equal(updated.name, 'Vaporwave');

      await prisma.genre.delete({ where: { genreId: created.genreId } });
      const gone = await prisma.genre.findUnique({
        where: { genreId: created.genreId },
      });
      assert.equal(gone, null);
    });

    it('updateMany affects the matching rows', async () => {
      const result = await prisma.genre.updateMany({
        where: { name: 'Rock' },
        data: { name: 'Classic Rock' },
      });
      assert.equal(result.count, 1);
      const renamed = await prisma.genre.findFirst({
        where: { name: 'Classic Rock' },
      });
      assert.ok(renamed);
    });

    it('deleteMany removes the matching rows', async () => {
      const created = await prisma.genre.create({ data: { name: 'Temp1' } });
      await prisma.genre.create({ data: { name: 'Temp2' } });
      const result = await prisma.genre.deleteMany({
        where: { name: { startsWith: 'Temp' } },
      });
      assert.equal(result.count, 2);
      assert.equal(
        await prisma.genre.findUnique({ where: { genreId: created.genreId } }),
        null,
      );
    });
  });

  describe('relations', () => {
    it('loads a one-to-many include (Artist → Albums)', async () => {
      const artist = await prisma.artist.findUnique({
        where: { artistId: 1 },
        include: { album: true },
      });
      assert.ok(artist);
      assert.equal(artist.name, 'AC/DC');
      // AC/DC has 2 albums in canonical Chinook.
      assert.equal(artist.album.length, 2);
    });

    it('loads nested includes (Album → Tracks)', async () => {
      const album = await prisma.album.findUnique({
        where: { albumId: 1 },
        include: { track: true, artist: true },
      });
      assert.ok(album);
      assert.equal(album.artist.name, 'AC/DC');
      assert.equal(album.title, 'For Those About To Rock We Salute You');
      // Album 1 has 10 tracks.
      assert.equal(album.track.length, 10);
    });

    it('creates with nested relations (Artist + Album)', async () => {
      const artist = await prisma.artist.create({
        data: {
          name: 'Test Artist',
          album: { create: { title: 'Test Album' } },
        },
        include: { album: true },
      });
      assert.equal(artist.album.length, 1);
      assert.equal(artist.album[0].title, 'Test Album');
      assert.equal(artist.album[0].artistId, artist.artistId);
    });

    it('reads a many-to-many through a join table (Playlist ↔ Track)', async () => {
      const playlist = await prisma.playlist.findUnique({
        where: { playlistId: 1 },
        include: { playlistTrack: { include: { track: true } } },
      });
      assert.ok(playlist);
      assert.equal(playlist.name, 'Music');
      // Playlist 1 has many tracks; just verify shape.
      assert.ok(playlist.playlistTrack.length > 0);
      assert.ok(playlist.playlistTrack[0].track.name);
    });

    it('walks a self-referencing relation (Employee.reportsTo)', async () => {
      // Employee 2 (Nancy Edwards) reports to employee 1 (Andrew Adams).
      const nancy = await prisma.employee.findUnique({
        where: { employeeId: 2 },
        include: { employee: true },
      });
      assert.ok(nancy);
      assert.equal(nancy.firstName, 'Nancy');
      assert.equal(nancy.employee?.firstName, 'Andrew');
    });

    it('walks the reverse self-referencing relation (Employee → reports)', async () => {
      // Employee 1 (Andrew Adams) is the GM and has multiple direct reports.
      const andrew = await prisma.employee.findUnique({
        where: { employeeId: 1 },
        include: { otherEmployee: true },
      });
      assert.ok(andrew);
      assert.ok(andrew.otherEmployee.length >= 1);
    });
  });

  describe('queries', () => {
    it('filters with string contains', async () => {
      // Two artists in Chinook contain "Aerosmith": "Aerosmith" itself and a
      // compilation. Verify both are returned and every match contains it.
      const artists = await prisma.artist.findMany({
        where: { name: { contains: 'Aerosmith' } },
      });
      assert.equal(artists.length, 2);
      for (const a of artists) assert.match(a.name ?? '', /Aerosmith/);
    });

    it('filters with startsWith', async () => {
      const artists = await prisma.artist.findMany({
        where: { name: { startsWith: 'A' } },
      });
      assert.ok(artists.length > 0);
      for (const a of artists) assert.match(a.name ?? '', /^A/);
    });

    it('filters with numeric gt/lt', async () => {
      const longTracks = await prisma.track.findMany({
        where: { milliseconds: { gt: 600_000 } },
      });
      assert.ok(longTracks.length > 0);
      for (const t of longTracks) assert.ok(t.milliseconds > 600_000);
    });

    it('filters with `in`', async () => {
      const some = await prisma.genre.findMany({
        where: { genreId: { in: [1, 2, 3] } },
      });
      assert.equal(some.length, 3);
    });

    it('filters by relation', async () => {
      // All albums by AC/DC (artistId 1).
      const albums = await prisma.album.findMany({
        where: { artist: { name: 'AC/DC' } },
      });
      assert.equal(albums.length, 2);
    });

    it('orderBy + take + skip', async () => {
      const page = await prisma.track.findMany({
        orderBy: { name: 'asc' },
        take: 5,
        skip: 10,
      });
      assert.equal(page.length, 5);
      // Ascending: each name should be ≥ the previous lex.
      for (let i = 1; i < page.length; i++) {
        assert.ok(page[i].name >= page[i - 1].name);
      }
    });

    it('select projects specific columns', async () => {
      const rows = await prisma.album.findMany({
        where: { albumId: 1 },
        select: { albumId: true, title: true },
      });
      assert.equal(rows.length, 1);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['albumId', 'title']);
    });

    it('findFirst + orderBy returns the first match', async () => {
      const t = await prisma.track.findFirst({
        orderBy: { milliseconds: 'desc' },
      });
      assert.ok(t);
      // Longest track in Chinook is "Through a Looking Glass" by Battlestar
      // Galactica at ~5286953 ms (~88 min).
      assert.ok(t.milliseconds > 5_000_000);
    });
  });

  describe('aggregates', () => {
    it('count with a where clause', async () => {
      const acdcAlbums = await prisma.album.count({
        where: { artist: { name: 'AC/DC' } },
      });
      assert.equal(acdcAlbums, 2);
    });

    it('groupBy with _count', async () => {
      // Tracks per genre. groupBy with `by: ['genreId']` returns one row per
      // distinct genre with the bucket count.
      const groups = await prisma.track.groupBy({
        by: ['genreId'],
        _count: true,
        orderBy: { genreId: 'asc' },
      });
      assert.ok(groups.length > 0);
      const total = groups.reduce((acc, g) => acc + g._count, 0);
      assert.equal(total, COUNTS.Track);
    });

    it('aggregate with _sum and _avg', async () => {
      const result = await prisma.invoice.aggregate({
        _sum: { total: true },
        _avg: { total: true },
        _count: true,
      });
      assert.equal(result._count, COUNTS.Invoice);
      // Total revenue in canonical Chinook is 2328.60 across 412 invoices.
      // `total` is a Decimal column; Prisma returns a Decimal-like value.
      const sum = Number(result._sum.total);
      assert.ok(sum > 2000 && sum < 2500);
    });
  });

  describe('dates', () => {
    it('reads an existing DateTime as a Date instance', async () => {
      const emp = await prisma.employee.findUnique({
        where: { employeeId: 1 },
      });
      assert.ok(emp);
      assert.ok(emp.birthDate instanceof Date);
      // Andrew Adams born 1962-02-18 (UTC midnight in seed).
      assert.equal(emp.birthDate.getUTCFullYear(), 1962);
    });

    it('inserts a Date and reads it back', async () => {
      const fakeDate = new Date('1990-06-15T00:00:00.000Z');
      const created = await prisma.employee.create({
        data: {
          firstName: 'Test',
          lastName: 'User',
          birthDate: fakeDate,
        },
      });
      assert.ok(created.birthDate instanceof Date);
      assert.equal(created.birthDate.toISOString(), '1990-06-15T00:00:00.000Z');
    });

    it('filters by date range', async () => {
      const cutoff = new Date('2003-01-01T00:00:00.000Z');
      const recentInvoices = await prisma.invoice.findMany({
        where: { invoiceDate: { gte: cutoff } },
      });
      assert.ok(recentInvoices.length > 0);
      for (const inv of recentInvoices) {
        assert.ok((inv.invoiceDate as Date).getTime() >= cutoff.getTime());
      }
    });
  });

  describe('null handling', () => {
    it('reads a nullable column as null when unset', async () => {
      // Most customers have no `company`; pick one and verify.
      const c = await prisma.customer.findFirst({ where: { company: null } });
      assert.ok(c);
      assert.equal(c.company, null);
    });

    it('filters where a column IS NULL', async () => {
      const orphanCustomers = await prisma.customer.findMany({
        where: { company: null },
      });
      assert.ok(orphanCustomers.length > 0);
      for (const c of orphanCustomers) assert.equal(c.company, null);
    });

    it('filters where a column IS NOT NULL', async () => {
      const withCompany = await prisma.customer.findMany({
        where: { company: { not: null } },
      });
      assert.ok(withCompany.length > 0);
      for (const c of withCompany) assert.notEqual(c.company, null);
    });
  });

  describe('transactions', () => {
    it('commits a transaction', async () => {
      await prisma.$transaction(async (tx) => {
        await tx.genre.create({ data: { name: 'Tx-Commit' } });
      });
      const found = await prisma.genre.findFirst({
        where: { name: 'Tx-Commit' },
      });
      assert.ok(found);
    });

    it('rolls back a transaction when the callback throws', async () => {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await tx.genre.create({ data: { name: 'Tx-Rollback' } });
          throw new Error('boom');
        }),
      );
      const found = await prisma.genre.findFirst({
        where: { name: 'Tx-Rollback' },
      });
      assert.equal(found, null);
    });

    it('isolates concurrent transactions', async () => {
      // Two transactions writing different rows; both should commit cleanly.
      await Promise.all([
        prisma.$transaction(async (tx) => {
          await tx.genre.create({ data: { name: 'Tx-A' } });
        }),
        prisma.$transaction(async (tx) => {
          await tx.genre.create({ data: { name: 'Tx-B' } });
        }),
      ]);
      const a = await prisma.genre.findFirst({ where: { name: 'Tx-A' } });
      const b = await prisma.genre.findFirst({ where: { name: 'Tx-B' } });
      assert.ok(a);
      assert.ok(b);
    });
  });

  describe('errors', () => {
    it('rejects an FK violation on create', async () => {
      await assert.rejects(
        prisma.album.create({
          data: { title: 'Bad', artistId: 99999 },
        }),
      );
    });

    it('rejects a NOT NULL violation', async () => {
      await assert.rejects(
        // @ts-expect-error - intentionally missing required `title` field
        prisma.album.create({ data: { artistId: 1 } }),
      );
    });
  });
});
