/**
 * Axelor Business Solutions
 *
 * Copyright (C) 2005-2017 Axelor (<http://axelor.com>).
 *
 * This program is free software: you can redistribute it and/or  modify
 * it under the terms of the GNU Affero General Public License, version 3,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.axelor.rpc;

import static net.bytebuddy.description.modifier.FieldManifestation.TRANSIENT;
import static net.bytebuddy.description.modifier.Visibility.PRIVATE;
import static net.bytebuddy.implementation.FieldAccessor.ofBeanProperty;
import static net.bytebuddy.implementation.MethodDelegation.toField;
import static net.bytebuddy.matcher.ElementMatchers.isDeclaredBy;
import static net.bytebuddy.matcher.ElementMatchers.isGetter;
import static net.bytebuddy.matcher.ElementMatchers.isProtected;
import static net.bytebuddy.matcher.ElementMatchers.isPublic;
import static net.bytebuddy.matcher.ElementMatchers.isSetter;
import static net.bytebuddy.matcher.ElementMatchers.nameStartsWith;

import java.util.Map;

import com.axelor.db.mapper.Mapper;
import com.axelor.db.mapper.Property;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;

import net.bytebuddy.ByteBuddy;
import net.bytebuddy.dynamic.DynamicType.Builder;
import net.bytebuddy.implementation.InvocationHandlerAdapter;

/**
 * Factory to create {@link ContextHandler}
 *
 */
public final class ContextHandlerFactory {

	private static final ByteBuddy BYTE_BUDDY = new ByteBuddy();

	private static final String FIELD_HANDLER = "contextHandler";

	private static final String COMPUTE_METHOD_PREFIX = "compute";

	private static final LoadingCache<Class<?>, Class<?>> PROXY_CACHE = CacheBuilder.newBuilder()
			.weakKeys()
			.weakValues()
			.maximumSize(500)
			.build(new CacheLoader<Class<?>, Class<?>>() {
				public Class<?> load(Class<?> key) throws Exception {
					return makeProxy(key);
				}
			});

	private ContextHandlerFactory() {
	}

	private static boolean hasJsonFields(Class<?> beanClass) {
		final Property attrs = Mapper.of(beanClass).getProperty(Context.KEY_JSON_ATTRS);
		return attrs != null && attrs.isJson();
	}
	
	private static <T> Class<? extends T> makeProxy(final Class<T> beanClass) {
		Builder<T> builder = BYTE_BUDDY.subclass(beanClass)
				.method(isPublic().and(isGetter().or(isSetter())))
				.intercept(toField(FIELD_HANDLER))
				.method(isProtected().and(nameStartsWith(COMPUTE_METHOD_PREFIX)))
				.intercept(toField(FIELD_HANDLER))
				.implement(ContextEntity.class)
				.intercept(toField(FIELD_HANDLER))
				.defineField(FIELD_HANDLER, ContextHandler.class, PRIVATE, TRANSIENT)
				.implement(HandlerAccessor.class)
				.intercept(ofBeanProperty());

		// allow to seamlessly handle json field values from scripts
		if (hasJsonFields(beanClass)) {
			builder = builder.implement(Map.class)
					.method(isDeclaredBy(Map.class))
					.intercept(InvocationHandlerAdapter.of((proxy, method, args) -> 
						((HandlerAccessor) proxy).getContextHandler().intercept(null, method, args)));
		}

		return builder.make().load(beanClass.getClassLoader()).getLoaded();
	}

	public static <T> ContextHandler<T> newHandler(Class<T> beanClass, Map<String, Object> values) {
		final ContextHandler<T> handler = new ContextHandler<>(beanClass, values);
		try {
			final Class<? extends T> proxyClass = PROXY_CACHE.get(beanClass).asSubclass(beanClass);
			final T proxy = proxyClass.newInstance();
			((HandlerAccessor) proxy).setContextHandler(handler);
			handler.setProxy(proxy);
			return handler;
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}

	public static interface HandlerAccessor {

		public ContextHandler<?> getContextHandler();

		public void setContextHandler(ContextHandler<?> contextHandler);
	}
}
