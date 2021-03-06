import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Table } from 'antd';
import React, { useCallback, useMemo, useState } from 'react';

import Icon from 'components/Icon';
import Page from 'components/Page';
import { Indicator } from 'components/Spinner';
import {
  defaultRowClassName, getPaginationConfig, isAlternativeAction, MINIMUM_PAGE_SIZE,
} from 'components/Table';
import { TaskRenderer } from 'components/Table';
import TableBatch from 'components/TableBatch';
import TaskFilter from 'components/TaskFilter';
import Auth from 'contexts/Auth';
import { Commands, Notebooks, Shells, Tensorboards } from 'contexts/Commands';
import Users from 'contexts/Users';
import handleError, { ErrorLevel, ErrorType } from 'ErrorHandler';
import useRestApi from 'hooks/useRestApi';
import useStorage from 'hooks/useStorage';
import {
  getCommands, getNotebooks, getShells, getTensorboards, killCommand,
} from 'services/api';
import { EmptyParams } from 'services/types';
import { ALL_VALUE, Command, CommandTask, CommandType, TaskFilters } from 'types';
import { getPath, numericSorter } from 'utils/data';
import { handlePath, openBlank } from 'utils/routes';
import { canBeOpened, filterTasks } from 'utils/task';
import { commandToTask, isTaskKillable } from 'utils/types';

import css from './TaskList.module.scss';
import { columns as defaultColumns } from './TaskList.table';

const MAX_SOURCES = 5;

const defaultFilters: TaskFilters<CommandType> = {
  limit: MINIMUM_PAGE_SIZE,
  states: [ ALL_VALUE ],
  types: {
    [CommandType.Command]: false,
    [CommandType.Notebook]: false,
    [CommandType.Shell]: false,
    [CommandType.Tensorboard]: false,
  },
  username: undefined,
};

const TaskList: React.FC = () => {
  const auth = Auth.useStateContext();
  const users = Users.useStateContext();
  const commands = Commands.useStateContext();
  const notebooks = Notebooks.useStateContext();
  const shells = Shells.useStateContext();
  const tensorboards = Tensorboards.useStateContext();
  const storage = useStorage('task-list');
  const initFilters = storage.getWithDefault('filters', {
    ...defaultFilters, username: getPath<string>(auth, 'user.username'),
  });
  const [ filters, setFilters ] = useState<TaskFilters<CommandType>>(initFilters);
  const [ search, setSearch ] = useState('');
  const [ selectedRowKeys, setSelectedRowKeys ] = useState<string[]>([]);
  const [ sourceExpanded, setSourceExpanded ] = useState<Record<string, boolean>>({});
  const [ commandsResponse, triggerCommandsRequest ] =
    useRestApi<EmptyParams, Command[]>(getCommands, {});
  const [ notebooksResponse, triggerNotebooksRequest ] =
    useRestApi<EmptyParams, Command[]>(getNotebooks, {});
  const [ shellsResponse, triggerShellsRequest ] =
    useRestApi<EmptyParams, Command[]>(getShells, {});
  const [ tensorboardsResponse, triggerTensorboardsRequest ] =
    useRestApi<EmptyParams, Command[]>(getTensorboards, {});

  const sources = [ commands, notebooks, shells, tensorboards ];

  const loadedTasks = sources
    .filter(src => src.data !== undefined)
    .map(src => src.data || [])
    .reduce((acc, cur) => [ ...acc, ...cur ], [])
    .map(commandToTask);

  const hasLoaded = sources.find(src => src.hasLoaded);

  const filteredTasks = useMemo(() => {
    return filterTasks(loadedTasks, filters, users.data || [], search);
  }, [ filters, loadedTasks, search, users.data ]);

  const showBatch = selectedRowKeys.length !== 0;

  const taskMap = useMemo(() => {
    return (loadedTasks || []).reduce((acc, task) => {
      acc[task.id] = task;
      return acc;
    }, {} as Record<string, CommandTask>);
  }, [ loadedTasks ]);

  const selectedTasks = useMemo(() => {
    return selectedRowKeys.map(key => taskMap[key]);
  }, [ selectedRowKeys, taskMap ]);

  const hasKillable = useMemo(() => {
    for (let i = 0; i < selectedTasks.length; i++) {
      if (isTaskKillable(selectedTasks[i])) return true;
    }
    return false;
  }, [ selectedTasks ]);

  const fetchTasks = useCallback((): void => {
    triggerCommandsRequest({});
    triggerNotebooksRequest({});
    triggerShellsRequest({});
    triggerTensorboardsRequest({});
  }, [
    triggerCommandsRequest,
    triggerNotebooksRequest,
    triggerShellsRequest,
    triggerTensorboardsRequest,
  ]);

  const handleSourceExpand = useCallback((event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setSourceExpanded(prev => {
      const newSourceExpanded = { ...prev };
      if (!newSourceExpanded[id]) newSourceExpanded[id] = true;
      else delete newSourceExpanded[id];
      return newSourceExpanded;
    });
  }, []);

  const columns = useMemo(() => {
    const sourceRenderer: TaskRenderer = (_, record) => {
      const info = {
        isPlural: false,
        label: '',
        path: '',
        source: [] as number[],
      };
      if (record.misc?.experimentIds) {
        info.label = 'Experiment';
        info.path = '/det/experiments';
        info.source = record.misc.experimentIds || [];
      } else if (record.misc?.trialIds) {
        info.label = 'Trial';
        info.path = '/det/trials';
        info.source = record.misc.trialIds || [];
      }
      info.isPlural = info.source.length > 1;
      info.source.sort(numericSorter);

      const isExpanded = sourceExpanded[record.id];
      const sourceCount = info.source.length - MAX_SOURCES;
      const showToggle = info.source.length > MAX_SOURCES;
      const toggleLabel = isExpanded ? 'Collapse' : `Show ${sourceCount}+`;

      return sourceCount !== 0 ? (
        <div className={css.sourceLinks}>
          <label>{info.label}{info.isPlural ? 's' : ''}</label>
          {info.source.map((id, index) => {
            const display = index < MAX_SOURCES || isExpanded ? 'inline' : 'none';
            const handleClick = (event: React.MouseEvent) => {
              event.stopPropagation();
              handlePath(event, { path: `${info.path}/${id}` });
            };
            return <a key={id} style={{ display }} onClick={handleClick}>{id}</a>;
          })}
          {showToggle && <button onClick={e => handleSourceExpand(e, record.id)}>
            {toggleLabel}
          </button>}
        </div>
      ) : null;
    };

    const newColumns = [ ...defaultColumns ];
    const sourceColumn = newColumns.find(column => /sources/i.test(column.title as string));
    if (sourceColumn) sourceColumn.render = sourceRenderer;

    return newColumns;
  }, [ handleSourceExpand, sourceExpanded ]);

  /*
   * Check once every second to see if all task endpoints have resolved.
   * Consider it a failure if the number of checks exceed 10 times.
   */
  const checkForTaskListUpdate = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      let counter = 0;
      const timer = setInterval(() => {
        if (!commandsResponse.isLoading && !notebooksResponse.isLoading &&
            !shellsResponse.isLoading && !tensorboardsResponse.isLoading) {
          clearInterval(timer);
          resolve();
        } else if (counter > 10) reject();
        counter++;
      }, 1000);
    });
  }, [
    commandsResponse.isLoading,
    notebooksResponse.isLoading,
    shellsResponse.isLoading,
    tensorboardsResponse.isLoading,
  ]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value || '');
  }, []);

  const handleFilterChange = useCallback((filters: TaskFilters<CommandType>): void => {
    storage.set('filters', filters);
    setFilters(filters);
  }, [ setFilters, storage ]);

  const handleBatchKill = useCallback(async () => {
    try {
      const promises = selectedTasks
        .filter(task => isTaskKillable(task))
        .map(task => killCommand({ commandId: task.id, commandType: task.type }));
      await Promise.all(promises);
      fetchTasks();
      await checkForTaskListUpdate();
    } catch (e) {
      handleError({
        error: e,
        level: ErrorLevel.Error,
        message: e.message,
        publicMessage: 'Please try again later.',
        publicSubject: 'Unable to Kill Selected Tasks',
        silent: false,
        type: ErrorType.Server,
      });
    }
  }, [ checkForTaskListUpdate, fetchTasks, selectedTasks ]);

  const handleConfirmation = useCallback(() => {
    Modal.confirm({
      content: `
        Are you sure you want to kill
        all the eligible selected experiments?
      `,
      icon: <ExclamationCircleOutlined />,
      okText: 'Kill',
      onOk: handleBatchKill,
      title: 'Confirm Batch Kill',
    });
  }, [ handleBatchKill ]);

  const handleTableRowSelect = useCallback(rowKeys => setSelectedRowKeys(rowKeys), []);

  const handleTableRow = useCallback((record: CommandTask) => ({
    onClick: (event: React.MouseEvent) => {
      if (isAlternativeAction(event) || !canBeOpened(record)) return;
      openBlank(record.url as string);
    },
  }), []);

  return (
    <Page id="tasks" title="Tasks">
      <div className={css.base}>
        <div className={css.header}>
          <Input
            allowClear
            className={css.search}
            placeholder="ID or name"
            prefix={<Icon name="search" size="small" />}
            onChange={handleSearchChange} />
          <TaskFilter<CommandType>
            filters={filters}
            showExperiments={false}
            showLimit={false}
            onChange={handleFilterChange} />
        </div>
        <TableBatch message="Apply batch operations to multiple tasks." show={showBatch}>
          <Button
            danger
            disabled={!hasKillable}
            type="primary"
            onClick={handleConfirmation}>Kill</Button>
        </TableBatch>
        <Table
          columns={columns}
          dataSource={filteredTasks}
          loading={{
            indicator: <Indicator />,
            spinning: !hasLoaded,
          }}
          pagination={getPaginationConfig(filteredTasks.length)}
          rowClassName={record => defaultRowClassName(canBeOpened(record))}
          rowKey="id"
          rowSelection={{ onChange: handleTableRowSelect, selectedRowKeys }}
          showSorterTooltip={false}
          size="small"
          onRow={handleTableRow} />
      </div>
    </Page>
  );
};

export default TaskList;
