# AI policy

Edinot is built with the help of AI, and it is meant to be used with AI: it
exposes your notes to assistants through MCP. So contributions made with AI are
welcome, in code, docs and translations alike. What matters is not *who* typed
it, but that it is good, and that a person stands behind it.

This is the same policy as the sibling projects
[pleamar](https://github.com/k4ditano/pleamar),
[pleamar-wm](https://github.com/k4ditano/pleamar-wm) and
[Sonda](https://github.com/k4ditano/sonda).

## If AI helped with your contribution

- **Say so.** One line in the pull request is enough, e.g. "Written with
  Claude Code, reviewed and tested by me". No need to detail prompts.
- **You are responsible for it.** You have read every line, you understand what
  it does and why, and you can answer questions about it in the review. "The AI
  wrote it" is not an answer to a bug.
- **Test it.** `npm test` passes, `npm run build` is clean, and for anything
  visual you have seen it running: a screenshot or a short clip in the PR helps a
  lot. Run the app on a throwaway profile so your own notes stay out of it:
  point `HOME`, `XDG_CONFIG_HOME`, `EDINOT_HUB_DIR` and `EDINOT_HUB_PORT`
  somewhere else and pass `--user-data-dir` to Electron.
- **Keep it focused.** One change per pull request. A large generated PR that
  touches everything is hard to review and will likely be asked to be split.
- **Follow the house style.** New code, comments and commits in English, with
  comments that say *why*, the way the surrounding code does. (Some older code
  has Spanish comments: leave them, or translate them when you touch that
  code.) AI tends to add noise — restating the code, generic comments: please
  trim it.
- **Do not invent.** The commands, settings and APIs you mention in docs must
  exist. Made-up features in docs will be rejected.
- **Two languages.** The interface and the user-facing docs come in English and
  Spanish. If you change a visible string, change both (`ui/i18n-*.js`).

## Issues and discussions

Using AI to write a bug report or to translate your message is fine. Please
make sure the steps to reproduce are real and that you have actually seen the
problem.

## Licensing

By contributing you confirm you have the right to submit the work under the
project's BSD 3-Clause license, whatever tools you used to write it. Do not
paste code from sources with incompatible licenses, AI-suggested or not.

## The maintainer

Much of Edinot, like pleamar, pleamar-wm and Sonda, has been written with AI
assistance (Claude), designed, reviewed, tested and used every day by its
maintainer.
