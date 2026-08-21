modify: /etc/avahi/aliases.d/default

restart
sudo /etc/init.d/avahi-daemon restart
$ python /usr/local/bin/avahi-alias stop
$ python /usr/local/bin/avahi-alias start

from:
https://github.com/airtonix/avahi-aliases

#py3
https://github.com/george-hawkins/avahi-aliases-notes
NetrwBrowseX
" s:NetrwBrowseX: (implements "x") executes a special "viewer" script or program for the {{{2
" given filename; typically this means given their extension.
" 0=local, 1=remote
fun! netrw#NetrwBrowseX(fname,remote)

# Download python3-avahi

https://launchpad.net/~yavdr/+archive/ubuntu/experimental-main/+files/python3-avahi_0.0.1-1yavdr6~focal_all.deb

sudo systemctl restart avahi-alias
sudo /etc/init.d/avahi-daemon restart
