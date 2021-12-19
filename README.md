# Allegro Container

Allegro Container, based on Mozilla's Facebook container, is dedicated to isolate your purcheses on sites belonging to Grupa Allegro (Allegro.pl, Oponeo, Ceneo, etc.) from the rest of the internet and acivtivites on other websites, greatly limiting possiblity of targeting you.

**Note:** To learn more about Containers in general, see [Firefox Multi-Account Containers](https://support.mozilla.org/kb/containers).

## How does Allegro Container work?

The Add-on keeps Allegro in a separate Container to prevent it from following your activity on other websites. When you first install the add-on, it signs you out of Allegro and deletes the cookies that Allegro uses to track you on other websites.

Every time you visit websites from Allegro, it will open in its own container, separate from other websites you visit.  You can login to Allegro within its container.  When browsing outside the container, Allegro won’t be able to easily collect your browsing data and connect it to your Allegro account or purcheses.

## How do I enable Allegro Container?

We’ve made it easy to take steps to protect your privacy so you can go on with your day.

1. [Install Allegro Container](https://addons.mozilla.org/firefox/addon/allegro-container/). This will log you out of Allegro and delete the cookies it’s been using to track you.
2. Open Allegro and use it like you normally would. Firefox will automatically switch to the Allegro Container tab for you.
3. If you click on a link to a page outside of Allegro or type in another website in the address bar, Firefox will load them outside of the Allegro Container

## How does this affect Allegro’s features?

Allegro Containers prevents Allegro from linking your activity on other websites to your Allegro identity. Therefore, the following will not work:

### Logging in or creating accounts on other websites using Allegro

Websites that allow you to create an account or log in using Allegro will generally not work properly.

## Will this protect me from Allegro completely?

This add-on does not prevent Allegro from mishandling the data it already has or permitted others to obtain about you. Allegro still will have access to everything that you do while you are on Allegro.pl and it's depenedent services, or on the Allegro app, including your Allegro comments, product rating, photo uploads for items sold, observed, purchased and any data you share with Allegro connected apps, etc.  

Other ad networks may try to link your Allegro activities with your regular browsing. In addition to this add-on, there are other things you can do to maximize your protection, including changing your Allegro settings, using Private Browsing and Tracking Protection, blocking third-party cookies, and/or using [Firefox Multi-Account Containers](https://addons.mozilla.org/firefox/addon/multi-account-containers/ ) extension to further limit tracking.

## How do I use Containers for other websites?

Good news! Containers aren’t just for Allegro. You can use Containers to prevent websites from linking your identities across the Web by installing [Firefox Multi-Account Containers](https://addons.mozilla.org/firefox/addon/multi-account-containers/).

To learn more about how Multi-Account Containers work, see our support page at [Firefox Multi-Account Containers](https://addons.mozilla.org/firefox/addon/multi-account-containers/).

## Development

1. `npm install`
2. `./node_modules/.bin/web-ext run -s src/`

### Testing

`npm run test`

or

`npm run lint`

for just the linter

### Links

- [License](./LICENSE)
- [Contributing](./CONTRIBUTING.md)
- [Code Of Conduct](./CODE_OF_CONDUCT.md)
