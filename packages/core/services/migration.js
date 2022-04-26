const urlJoin = require('url-join');
const { getSlugFromUri } = require("@semapps/ldp");

function getAclUriFromResourceUri(baseUrl, resourceUri) {
  return urlJoin(baseUrl, resourceUri.replace(baseUrl, '_acl/'));
}

const replaceRules = {
  invitees: 'announces',
  inviters: 'announcers',
};

module.exports = {
  name: 'migration',
  settings: {
    baseUrl: null
  },
  actions: {
    async migrate(ctx) {
      const { version } = ctx.params;

      if( version === '1.1.0' ) {
        for (let dataset of await ctx.call('pod.list')) {
          const [account] = await ctx.call('auth.account.find', { query: { username: dataset } });

          // TODO compare if version is greater than account version
          if( account.version !== version ) {
            this.logger.info(`Migrating dataset ${dataset} to v${version}...`);

            for( let [from, to] of Object.entries(replaceRules) ) {
              await ctx.call('migration.replacePredicate', {
                oldPredicate: 'http://activitypods.org/ns/core#' + from,
                newPredicate: 'http://activitypods.org/ns/core#' + to,
                dataset
              });
            }

            const resources = await ctx.call('ldp.container.getUris', { containerUri: urlJoin(this.settings.baseUrl, dataset, 'data', 'events') });
            for (let resourceUri of resources) {
              const resourceSlug = getSlugFromUri(resourceUri);

              for( let [from, to] of Object.entries(replaceRules) ) {
                await ctx.call('migration.moveResource', {
                  oldResourceUri: urlJoin(resourceUri, from),
                  newResourceUri: urlJoin(resourceUri, to),
                  dataset
                });

                await ctx.call('migration.moveAclGroup', {
                  oldGroupUri: urlJoin(this.settings.baseUrl, '_groups', dataset, 'data', 'events', resourceSlug, from),
                  newGroupUri: urlJoin(this.settings.baseUrl, '_groups', dataset, 'data', 'events', resourceSlug, to),
                  dataset
                });
              }
            }

            await ctx.call('auth.account.update', {
              '@id': account['@id'],
              version
            });

            this.logger.info('Done !');
          } else {
            this.logger.warn(`Dataset ${dataset} is already on v${version}, skipping...`);
          }
        }
      }
    },
    async replacePredicate(ctx) {
      const { oldPredicate, newPredicate, dataset } = ctx.params;

      this.logger.info(`Replacing predicate ${oldPredicate} to ${newPredicate}...`);

      await ctx.call('triplestore.update', {
        query: `
          DELETE { ?s <${oldPredicate}> ?o . }
          INSERT { ?s <${newPredicate}> ?o . }
          WHERE { ?s <${oldPredicate}> ?o . }
        `,
        dataset,
        webId: 'system'
      });
    },
    async moveResource(ctx) {
      const { oldResourceUri, newResourceUri, dataset } = ctx.params;

      this.logger.info(`Moving resource ${oldResourceUri} to ${newResourceUri}...`);

      await ctx.call('triplestore.update', {
        query: `
          DELETE { <${oldResourceUri}> ?p ?o  }
          INSERT { <${newResourceUri}> ?p ?o }
          WHERE { <${oldResourceUri}> ?p ?o }
        `,
        dataset,
        webId: 'system'
      });

      await ctx.call('triplestore.update', {
        query: `
          DELETE { ?s ?p <${oldResourceUri}> }
          INSERT { ?s ?p <${newResourceUri}> }
          WHERE { ?s ?p <${oldResourceUri}> }
        `,
        dataset,
        webId: 'system'
      });

      await ctx.call('triplestore.update', {
        query: `
          WITH <http://semapps.org/webacl>
          DELETE { ?s ?p <${oldResourceUri}> }
          INSERT { ?s ?p <${newResourceUri}> }
          WHERE { ?s ?p <${oldResourceUri}> }
        `,
        dataset,
        webId: 'system'
      });

      await ctx.call('migration.moveAclRights', { newResourceUri, oldResourceUri, dataset });
    },
    async moveAclGroup(ctx) {
      const { oldGroupUri, newGroupUri, dataset } = ctx.params;

      this.logger.info(`Moving ACL group ${oldGroupUri} to ${newGroupUri}...`);

      await ctx.call('triplestore.update', {
        query: `
          WITH <http://semapps.org/webacl>
          DELETE { <${oldGroupUri}> ?p ?o }
          INSERT { <${newGroupUri}> ?p ?o }
          WHERE { <${oldGroupUri}> ?p ?o }
        `,
        dataset,
        webId: 'system'
      });

      await ctx.call('triplestore.update', {
        query: `
          WITH <http://semapps.org/webacl>
          DELETE { ?s ?p <${oldGroupUri}> }
          INSERT { ?s ?p <${newGroupUri}> }
          WHERE { ?s ?p <${oldGroupUri}> }
        `,
        dataset,
        webId: 'system'
      });

      await ctx.call('migration.moveAclRights', { newResourceUri: newGroupUri, oldResourceUri: oldGroupUri, dataset });
    },
    async moveAclRights(ctx) {
      const { oldResourceUri, newResourceUri, dataset } = ctx.params;

      for( let right of ['Read', 'Append', 'Write', 'Control'] ) {
        const oldResourceAclUri = getAclUriFromResourceUri(this.settings.baseUrl, oldResourceUri) + '#' + right;
        const newResourceAclUri = getAclUriFromResourceUri(this.settings.baseUrl, newResourceUri) + '#' + right;

        this.logger.info(`Moving ACL rights ${oldResourceAclUri} to ${newResourceAclUri}...`);

        await ctx.call('triplestore.update', {
          query: `
            WITH <http://semapps.org/webacl>
            DELETE { <${oldResourceAclUri}> ?p ?o }
            INSERT { <${newResourceAclUri}> ?p ?o }
            WHERE { <${oldResourceAclUri}> ?p ?o }
          `,
          dataset,
          webId: 'system'
        });
      }
    }
  }
}