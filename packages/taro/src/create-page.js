import { isEmptyObject, getPrototypeChain } from './util'
import { get as safeGet } from './internal/safe-get'

const eventPreffix = '__event_'
const rootScopeKey = '__root_'
const componentPath = 'componentPath'
const scopeMap = {}
const pageExtraFns = ['onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll', 'onTabItemTap']

function processEvent (pagePath, eventHandlerName, obj) {
  let newEventHandlerName = eventHandlerName.replace(eventPreffix, '')
  if (obj[newEventHandlerName]) {
    return
  }
  obj[newEventHandlerName] = function (event) {
    if (event) {
      event.preventDefault = function () {}
      event.stopPropagation = function () {}
      Object.assign(event.target, event.detail)
      Object.assign(event.currentTarget, event.detail)
    }
    const dataset = event.currentTarget.dataset
    const theComponent = scopeMap[pagePath][dataset[componentPath] || rootScopeKey]
    let scope = theComponent
    const bindArgs = {}
    const componentClassName = dataset['componentClass']
    const newEventHandlerNameLower = newEventHandlerName.toLocaleLowerCase()
    Object.keys(dataset).forEach(key => {
      let keyLower = key.toLocaleLowerCase()
      if (keyLower.indexOf('event') === 0) {
        keyLower = keyLower.replace('event', '')
        keyLower = componentClassName ? `${componentClassName}__${keyLower}` : keyLower
        keyLower = keyLower.toLocaleLowerCase()
        if (keyLower.indexOf(newEventHandlerNameLower) >= 0) {
          const argName = keyLower.replace(newEventHandlerNameLower, '')
          bindArgs[argName] = dataset[key]
        }
      }
    })
    if (!isEmptyObject(bindArgs)) {
      if (bindArgs['scope'] !== 'this') {
        scope = bindArgs['scope']
      }
      delete bindArgs['scope']
      const realArgs = Object.keys(bindArgs)
        .sort()
        .map(key => bindArgs[key])

      realArgs.push(event)
      const newHandler = () => {
        return theComponent[eventHandlerName].apply(scope, realArgs)
      }
      newHandler()
    } else {
      if (dataset[componentPath]) {
        scope = scopeMap[pagePath][dataset[componentPath] || rootScopeKey]
      }
      theComponent[eventHandlerName].call(scope, event)
    }
  }
}
function initPage (weappPageConf, page, options) {
  const pagePath = options.path
  scopeMap[pagePath] = scopeMap[pagePath] || {}
  function recurrenceComponent (weappPageConf, component, path) {
    component.$path = path || ''
    component.props.$path = component.$path
    if (path) {
      scopeMap[pagePath][path] = component
    } else {
      scopeMap[pagePath][rootScopeKey] = component
    }
    if (!isEmptyObject(component.$components)) {
      Object.getOwnPropertyNames(component.$components).forEach(function (name) {
        const _class = component.$components[name]
        const comPath = `${component.$path}$$${name}`
        let _props = (component.$props || {})[name] || {}
        let props =
          typeof _props === 'function' ? _props.call(component) : _props

        const child = new _class(props)
        component.$$components[name] = child

        recurrenceComponent(weappPageConf, child, comPath)
      })
    }
    for (const k in component) {
      if (k.indexOf(eventPreffix) >= 0) {
        processEvent(pagePath, k, weappPageConf)
      }
    }
    const prototypeChain = getPrototypeChain(component)
    prototypeChain.forEach(item => {
      Object.getOwnPropertyNames(item).forEach(fn => {
        if (fn.indexOf(eventPreffix) >= 0) {
          processEvent(pagePath, fn, weappPageConf)
        }
      })
    })

    return weappPageConf
  }
  return recurrenceComponent(weappPageConf, page)
}

export function processDynamicComponents (page) {
  const pagePath = page.path
  scopeMap[pagePath] = scopeMap[pagePath] || {}
  function recursiveDynamicComponents (component) {
    if (component.$dynamicComponents && !isEmptyObject(component.$dynamicComponents)) {
      component.$$dynamicComponents = component.$$dynamicComponents || {}
      Object.getOwnPropertyNames(component.$dynamicComponents).forEach(name => {
        const dynamicComponetFn = component.$dynamicComponents[name]
        const loopRes = dynamicComponetFn()
        const stateName = loopRes.stateName
        const loopComponents = loopRes.loopComponents
        const stateData = safeGet(component.state, stateName)
        recurrence(loopComponents, stateData)
        function recurrence (loopComponents, stateData) {
          loopComponents.forEach(item => {
            const _class = item.path
            const components = item.components
            const children = item.children
            const subscript = item.subscript
            stateData = subscript ? safeGet(stateData, subscript) : stateData
            if (!stateData) {
              return
            }
            if (components && components.length) {
              components.forEach(function (item, index) {
                const comPath = `${component.$path}$$${item.fn}`
                let child
                Object.getOwnPropertyNames(component.$$dynamicComponents).forEach(c => {
                  if (c === comPath) {
                    child = component.$$dynamicComponents[c]
                  }
                })
                if (!child) {
                  child = new _class(item.body)
                  child.$path = comPath
                  child.props.$path = comPath
                  child._init(component.$scope)
                  child._initData(component.$root || component, component)
                  componentTrigger(child, 'componentWillMount')
                }

                if (stateData) {
                  stateData[index] = Object.assign({}, { ...stateData[index] }, child.props, child.state)
                }
                component.$$dynamicComponents[comPath] = child
                scopeMap[pagePath][comPath] = child
                for (const k in child) {
                  if (k.indexOf(eventPreffix) >= 0) {
                    processEvent(pagePath, k, component)
                  }
                }
                const prototypeChain = getPrototypeChain(child)
                prototypeChain.forEach(item => {
                  Object.getOwnPropertyNames(item).forEach(fn => {
                    if (fn.indexOf(eventPreffix) >= 0) {
                      processEvent(pagePath, fn, component)
                    }
                  })
                })
                if (item.children && item.children.length) {
                  recurrence(item.children, stateData[index])
                }
                recursiveDynamicComponents(item)
              })
            }
            if (children && children.length) {
              stateData.forEach(item => {
                recurrence(children, item)
              })
            }
          })
        }
      })
    }
  }
  recursiveDynamicComponents(page)
}

function componentTrigger (component, key) {
  if (key === 'componentWillUnmount') {
    component._dirty = true
    component._disable = true
  }
  Object.getOwnPropertyNames(component.$$components || {}).forEach(name => {
    componentTrigger(component.$$components[name], key)
  })
  component[key] && typeof component[key] === 'function' && component[key]()
  if (key === 'componentWillMount') {
    if (component.$isComponent) {
      component.$router.params = component.$root.$router.params
    }
    component._dirty = false
    component._disable = false
    component.state = component.getState()
    component.forceUpdate()
  }
}

function createPage (PageClass, options) {
  const page = new PageClass()
  page.$isComponent = false
  page.path = options.path
  const weappPageConf = {
    onLoad (options) {
      page._init(this)
      page.$router.params = options
      componentTrigger(page, 'componentWillMount')
    },
    onReady () {
      componentTrigger(page, 'componentDidMount')
    },
    onShow () {
      componentTrigger(page, 'componentDidShow')
    },
    onHide () {
      componentTrigger(page, 'componentDidHide')
    },
    onUnload () {
      componentTrigger(page, 'componentWillUnmount')
    },
    _setData (data, cb, isRoot) {
      if (isRoot) {
        const filterData = {}
        for (let k in data) {
          if (typeof data[k] !== 'undefined') {
            filterData[k] = data[k]
          }
        }
        this.setData(filterData, () => {
          cb && cb()
        })
      }
    }
  }
  let weappPageConfEvents = initPage(weappPageConf, page, options)
  page._initData()
  processDynamicComponents(page)
  pageExtraFns.forEach(fn => {
    if (typeof page[fn] === 'function') {
      weappPageConf[fn] = page[fn].bind(page)
    }
  })
  return Object.assign(weappPageConfEvents, {
    data: page.$data
  })
}

export default createPage
