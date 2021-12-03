const waitForExpect = require('wait-for-expect');
const { ACTIVITY_TYPES } = require('@semapps/activitypub');
const initialize = require('./initialize');
const path = require("path");

jest.setTimeout(30000);

let broker;

const mockContactOffer = jest.fn(() => Promise.resolve("Fake Contact Offer"));

beforeAll(async () => {
  broker = await initialize();

  await broker.loadService(path.resolve(__dirname, './services/core.service.js'));
  await broker.loadService(path.resolve(__dirname, './services/contacts.app.js'));

  // Mock notification service
  await broker.createService({
    name: 'notification',
    actions: {
      contactOffer: mockContactOffer
    }
  });

  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

describe('Test contacts app', () => {
  let actors = [], alice, bob, craig, contactRequestToBob, contactRequestToCraig;

  test('Create 2 pods', async () => {
    for (let i = 1; i <= 3; i++) {
      const actorData = require(`./data/actor${i}.json`);

      const { webId } = await broker.call('auth.signup', actorData);

      actors[i] = await broker.call('activitypub.actor.awaitCreateComplete', { actorUri: webId, additionalKeys: ['url'] });

      expect(actors[i].preferredUsername).toBe(actorData.username);
    }

    alice = actors[1];
    bob = actors[2];
    craig = actors[3];
  });

  test('Alice offers her contact to Bob and Craig', async () => {
    contactRequestToBob = await broker.call('activitypub.outbox.post', {
      collectionUri: alice.outbox,
      type: ACTIVITY_TYPES.OFFER,
      actor: alice.id,
      object: {
        type: ACTIVITY_TYPES.ADD,
        object: alice.url,
      },
      content: "Salut Bob, tu te rappelles de moi ?",
      target: bob.id,
      to: bob.id
    });

    await waitForExpect(() => {
      expect(mockContactOffer).toHaveBeenCalledTimes(1)
    });

    await waitForExpect(async () => {
      await expect(broker.call('webacl.resource.hasRights', {
        resourceUri: alice.url,
        rights: { read: true },
        webId: bob.id
      })).resolves.toMatchObject({ read: true });
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: bob['apods:contactRequests'], itemUri: contactRequestToBob.id })).resolves.toBeTruthy()
    });

    contactRequestToCraig = await broker.call('activitypub.outbox.post', {
      collectionUri: alice.outbox,
      type: ACTIVITY_TYPES.OFFER,
      actor: alice.id,
      object: {
        type: ACTIVITY_TYPES.ADD,
        object: alice.url,
      },
      content: "Salut Craig, ça fait longtemps !",
      target: craig.id,
      to: craig.id
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', {
        collectionUri: bob['apods:contactRequests'],
        itemUri: contactRequestToCraig.id
      })).resolves.toBeFalsy()
    });
  });

  test('Bob accept Alice contact request', async () => {
    await broker.call('activitypub.outbox.post', {
      collectionUri: bob.outbox,
      type: ACTIVITY_TYPES.ACCEPT,
      actor: bob.id,
      object: contactRequestToBob.id,
      to: alice.id
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: bob['apods:contactRequests'], itemUri: contactRequestToBob.id })).resolves.toBeFalsy()
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: bob['apods:contacts'], itemUri: alice.id })).resolves.toBeTruthy()
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: alice['apods:contacts'], itemUri: bob.id })).resolves.toBeTruthy()
    });
  });

  test('Craig reject Alice contact request', async () => {
    await broker.call('activitypub.outbox.post', {
      collectionUri: craig.outbox,
      type: ACTIVITY_TYPES.REJECT,
      actor: craig.id,
      object: contactRequestToCraig.id,
      to: craig.id
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: craig['apods:contactRequests'], itemUri: contactRequestToCraig.id })).resolves.toBeFalsy()
    });

    await waitForExpect(async () => {
      await expect(broker.call('activitypub.collection.includes', { collectionUri: craig['apods:rejectedContacts'], itemUri: alice.id })).resolves.toBeTruthy()
    });
  });
});