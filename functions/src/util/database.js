const admin = require('firebase-admin');

const base = admin.firestore().collection('oauth2');


function entry({
  empty,
  docs,
}) {
  if (empty) return null;
  return docs[0].data();
}

exports.getByProvider = (provider, uid) => base
  .where('provider', '==', provider)
  .where('providerUID', '==', uid)
  .limit(1)
  .get()
  .then(entry);

exports.getByUID = (provider, uid) => base
  .where('provider', '==', provider)
  .where('UID', '==', uid)
  .limit(1)
  .get()
  .then(entry);

exports.addNewProvider = ({
  provider,
  providerUID,
  UID,
}) => base.add({
  provider,
  providerUID,
  UID,
});

exports.unlink = (data) => {
  if (!data) throw new Error('Missing data');
  let query = ['provider', 'UID'].reduce((query, key) => data[key] ? 
    query.where(key, '==', data[key]) :
    query, base);
  if (query === base) throw new Error('Missing provider and UID');
  if (data.provider && data.providerUID) {
    query = query.where('providerUID', '==', data.providerUID);
  }
  
  return query.get()
    .then(({ docs = []}) => Promise.all(docs.map(doc => doc.ref.delete())))
    .then(() => 'done');
};
