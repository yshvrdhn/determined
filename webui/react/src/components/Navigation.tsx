import { Button, Menu, Tooltip } from 'antd';
import React, { MouseEventHandler, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CSSTransition } from 'react-transition-group';

import Auth from 'contexts/Auth';
import ClusterOverview from 'contexts/ClusterOverview';
import UI from 'contexts/UI';
import handleError, { ErrorLevel, ErrorType } from 'ErrorHandler';
import useStorage from 'hooks/useStorage';
import { createNotebook } from 'services/api';
import { openBlank } from 'utils/routes';
import { commandToTask } from 'utils/types';

import Avatar from './Avatar';
import DropdownMenu, { Placement } from './DropdownMenu';
import Icon from './Icon';
import Link from './Link';
import css from './Navigation.module.scss';

interface ItemProps {
  badge?: number;
  icon: string;
  label: string;
  path?: string;
  popout?: boolean;
  status?: string;
  onClick?: MouseEventHandler;
}

const NavigationItem: React.FC<ItemProps> = ({ status, ...props }: ItemProps) => {
  const ui = UI.useStateContext();
  const location = useLocation();
  const [ isActive, setIsActive ] = useState(false);
  const classes = [ css.navItem ];

  if (isActive) classes.push(css.active);
  if (status) classes.push(css.hasStatus);

  useEffect(() => {
    setIsActive(location.pathname === props.path);
  }, [ classes, location.pathname, props.path ]);

  const link = (
    <Link className={classes.join(' ')} {...props}>
      <Icon name={props.icon} size="large" />
      <div className={css.label}>{props.label}</div>
      {status && <div className={css.status}>{status}</div>}
    </Link>
  );

  return ui.chromeCollapsed ? (
    <Tooltip placement="right" title={props.label}><div>{link}</div></Tooltip>
  ) : link;
};

const STORAGE_KEY = 'collapsed';

const Navigation: React.FC = () => {
  const { isAuthenticated, user } = Auth.useStateContext();
  const overview = ClusterOverview.useStateContext();
  const ui = UI.useStateContext();
  const setUI = UI.useActionContext();
  const storage = useStorage('navigation');
  const [ isCollapsed, setIsCollapsed ] = useState(storage.getWithDefault(STORAGE_KEY, false));
  const [ isShowingCpu, setIsShowingCpu ] = useState(false);

  const showNavigation = isAuthenticated && ui.showChrome;
  const version = process.env.VERSION || '';
  const shortVersion = version.split('.').slice(0, 3).join('.');
  const isVersionLong = (version.match(/\./g) || []).length > 2;
  const username = user?.username || 'Anonymous';
  const cluster = overview.allocation === 0 ? undefined : `${overview.allocation}%`;

  const launchNotebook = useCallback(async (slots: number) => {
    try {
      const notebook = await createNotebook({ slots });
      const task = commandToTask(notebook);
      if (task.url) openBlank(task.url);
      else throw new Error('Notebook URL not available.');
    } catch (e) {
      handleError({
        error: e,
        level: ErrorLevel.Error,
        message: e.message,
        publicMessage: 'Please try again later.',
        publicSubject: 'Unable to Launch Notebook',
        silent: false,
        type: ErrorType.Server,
      });
    }
  }, []);

  const handleNotebookLaunch = useCallback(() => launchNotebook(1), [ launchNotebook ]);
  const handleCpuNotebookLaunch = useCallback(() => launchNotebook(0), [ launchNotebook ]);
  const handleVisibleChange = useCallback((visible: boolean) => setIsShowingCpu(visible), []);

  const handleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed;
    storage.set(STORAGE_KEY, newCollapsed);
    setIsCollapsed(newCollapsed);
  }, [ isCollapsed, storage ]);

  useEffect(() => {
    setUI({ type: isCollapsed ? UI.ActionType.CollapseChrome : UI.ActionType.ExpandChrome });
  }, [ isCollapsed, setUI ]);

  return showNavigation ? (
    <CSSTransition
      appear={true}
      classNames={{
        enter: css.collapsedEnter,
        enterActive: css.collapsedEnterActive,
        enterDone: css.collapsedEnterDone,
        exit: css.collapsedExit,
        exitActive: css.collapsedExitActive,
        exitDone: css.collapsedExitDone,
      }}
      in={isCollapsed}
      timeout={200}>
      <nav className={css.base}>
        <header>
          <div className={css.logo}>
            <div className={css.logoIcon} />
            <div className={css.logoLabel} />
          </div>
          <div className={css.version}>
            {isVersionLong ? (
              <Tooltip placement="right" title={`Version ${version}`}>
                <span className={css.versionLabel}>{shortVersion}</span>
              </Tooltip>
            ) : (
              <span className={css.versionLabel}>{version}</span>
            )}
          </div>
        </header>
        <main>
          <section className={css.launch}>
            <div className={css.launchBlock}>
              <Button
                className={css.launchButton}
                onClick={handleNotebookLaunch}>Launch Notebook</Button>
              <DropdownMenu
                menu={(
                  <Menu>
                    {isCollapsed && <Menu.Item onClick={handleNotebookLaunch}>
                      Launch Notebook
                    </Menu.Item>}
                    <Menu.Item onClick={handleCpuNotebookLaunch}>
                      Launch CPU-only Notebook
                    </Menu.Item>
                  </Menu>
                )}
                offset={isCollapsed ? { x: 8, y: 0 } : { x: 0, y: 8 }}
                placement={isCollapsed ? Placement.RightTop : Placement.BottomRight}
                onVisibleChange={handleVisibleChange}>
                <Button className={css.launchIcon}>
                  <Icon name={isShowingCpu ? 'arrow-up': 'arrow-down'} size="tiny" />
                </Button>
              </DropdownMenu>
            </div>
          </section>
          <section className={css.top}>
            <NavigationItem icon="user" label="Dashboard" path="/det/dashboard" />
            <NavigationItem icon="experiment" label="Experiments" path="/det/experiments" />
            <NavigationItem icon="tasks" label="Tasks" path="/det/tasks" />
            <NavigationItem icon="cluster" label="Cluster" path="/det/cluster" status={cluster} />
          </section>
          <section className={css.bottom}>
            <NavigationItem icon="logs" label="Master Logs" path="/det/logs" popout />
            <NavigationItem icon="docs" label="Docs" path="/docs" popout />
            <NavigationItem icon="cloud" label="API" path="/swagger-ui" popout />
            <NavigationItem icon="collapse" label="Collapse" onClick={handleCollapse} />
          </section>
        </main>
        <footer>
          <DropdownMenu
            menu={<Menu>
              <Menu.Item>
                <Link path={'/det/logout'}>Sign Out</Link>
              </Menu.Item>
            </Menu>}
            offset={isCollapsed ? { x: -8, y: 0 } : { x: 16, y: -8 }}
            placement={isCollapsed ? Placement.Right : Placement.TopLeft}>
            <div className={css.user}>
              <Avatar hideTooltip name={username} />
              <span>{username}</span>
            </div>
          </DropdownMenu>
        </footer>
      </nav>
    </CSSTransition>
  ) : null;
};

export default Navigation;
