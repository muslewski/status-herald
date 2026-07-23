# awesome-tmux — status-herald

List: https://github.com/rothgar/awesome-tmux  
Section: **Tools and session management** (or **Status Bar** if you prefer the bar angle — Tools is better for curtain cards).

## One-line entry (PR body / README line)

```markdown
- [status-herald](https://github.com/muslewski/status-herald) Tmux curtain cards over busy panes (working / done / needs input) so you can scan a multi-pane grid without focusing each one
```

## PR title

```
Add status-herald — curtain cards for busy tmux panes
```

## PR description

```
Adds status-herald under Tools and session management.

What it is: a small CLI that draws opaque “curtain” cards over unfocused
tmux panes so a multi-pane grid is scannable (working / done / needs input).
Focus reveals the live pane again.

Why it belongs here: it’s built around tmux session options + pane cover/reveal,
not a generic agent framework.

- Repo: https://github.com/muslewski/status-herald
- License: MIT
- Install: `npm install -g status-herald`

I’m the author. Happy to tweak the blurb or section if you prefer Status Bar.
```

## How to open the PR

```bash
# one-time
gh repo fork rothgar/awesome-tmux --clone=true --remote=true
cd awesome-tmux
git checkout -b add-status-herald
# edit README.md — insert the bullet alphabetically under Tools and session management
git add README.md
git commit -m "Add status-herald to tools and session management"
gh pr create --repo rothgar/awesome-tmux --title "Add status-herald — curtain cards for busy tmux panes" --body-file /path/to/this/PR-description
```

Keep the list alphabetical if neighboring entries are sorted that way (many are loose; match neighbors).
