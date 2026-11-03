# Pub Cards

A party card game for terrible people, proper British edition. One person
hosts, everyone else joins by link or a four-letter room code. It runs in the
browser on phones and laptops, with no accounts and no server to pay for.

Adults only. The host picks which packs of cards to play with:

- **Cards Against Humanity (UK)**: the CAH base set with the UK edition
  cards, in [`cards-cah.js`](cards-cah.js). US spellings are swapped for
  British ones, and a handful of cards are left out: ones aimed at ethnic or
  religious groups, disabled or trans people, or real victims of abuse.
- **Pub Cards: Proper British**: original cards in [`cards.js`](cards.js).
- **Pub Cards: Absolutely Filthy**: ruder original cards in
  [`cards-filthy.js`](cards-filthy.js).

Add your own: a `_` in a prompt marks a blank, and prompts with two blanks
ask for two answers.

### Licence

The Cards Against Humanity text is © Cards Against Humanity LLC and is used
under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
(card data from
[json-against-humanity](https://github.com/crhallberg/json-against-humanity)).
So this game must stay free, and that file stays under the same licence. Pub
Cards isn't affiliated with or endorsed by Cards Against Humanity.

## Playing

1. Open the game and press **Start a game**.
2. Send the link (or the room code) to your mates.
3. When everyone's in, press **Start the game**. You need 3 players, and
   bots count.

The host's browser runs the game, so the host needs to keep their tab open.
If the host reloads by accident, the game picks up where it left off and
everyone reconnects by themselves.

## Extras

- **Bots**: up to three (The Bloke Down the Pub, Big Sandra from Bingo and
  Your Uncle Clive) who play random cards and win more often than they
  should. Bots take their turn as judge too, picking a winner at random.
  With two bots you can try the game on your own.
- **Random events** (from round 3, about one round in three):
  - *Bank Holiday*: double points.
  - *Rail Replacement*: everyone passes a random card to the left.
  - *Pub Vote*: no judge, everyone votes, and you can't vote for yourself.
  - *Spring Clean*: everyone gets a fresh hand.
  - *Happy Hour*: everyone gets an extra write-your-own card.
- **Write your own**: each player gets a few blank cards per game.
- **Swap your hand**: spend a point to bin your hand and draw a new one.
- **The Pundit**: reads each winning card aloud in a British voice (uses
  your device's built-in speech, and you can turn it off).
- **Reactions**: emoji that float up on everyone's screen.
- **Little Sith**: a pixel-art character who runs and jumps along the bottom
  of the screen, and does a spin when someone wins a round. Each player can
  switch him off. Sprites in `img/sith.png` were cut from a sheet jaa
  supplied.
- The host can remove players and move things on when someone's gone to the
  bar.

## How it works

- `core.js`: the rules. Pure functions, run only in the host's browser.
- `net.js`: connections. Players connect browser to browser with
  [PeerJS](https://peerjs.com) (MIT licence, bundled in `vendor/`), which uses
  the free public PeerJS server only to introduce players to each other.
- `app.js`: the screens.

Add `?local` to the URL to test on your own: each tab becomes a player, and
tabs talk to each other directly without the internet.

## Hosting

It's a static site. On GitHub: **Settings → Pages → Deploy from a branch →
`main` / root**. Any static host works too.

## Tests

```
npm test
```

simulates 300 random games through the rules engine.
