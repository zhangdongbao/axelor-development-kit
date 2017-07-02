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
package com.axelor.db;

import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import javax.inject.Inject;

import org.hibernate.MultiTenancyStrategy;
import org.hibernate.cache.infinispan.InfinispanRegionFactory;
import org.hibernate.cache.jcache.JCacheRegionFactory;
import org.hibernate.cfg.Environment;
import org.hibernate.hikaricp.internal.HikariCPConnectionProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.axelor.app.AppSettings;
import com.axelor.auth.AuditInterceptor;
import com.axelor.common.ResourceUtils;
import com.axelor.common.StringUtils;
import com.axelor.db.hibernate.naming.ImplicitNamingStrategyImpl;
import com.axelor.db.hibernate.naming.PhysicalNamingStrategyImpl;
import com.axelor.db.internal.DBHelper;
import com.axelor.db.search.SearchMappingFactory;
import com.axelor.db.search.SearchModule;
import com.axelor.db.tenants.TenantConnectionProvider;
import com.axelor.db.tenants.TenantModule;
import com.axelor.db.tenants.TenantResolver;
import com.google.inject.AbstractModule;
import com.google.inject.persist.PersistService;
import com.google.inject.persist.jpa.JpaPersistModule;

/**
 * A Guice module to configure JPA.
 *
 * This module takes care of initializing JPA and registers an Hibernate custom
 * scanner that automatically scans all the classpath entries for Entity
 * classes.
 *
 */
public class JpaModule extends AbstractModule {

	private static final String INFINISPAN_CONFIG = "infinispan.xml";
	private static final String INFINISPAN_CONFIG_FALLBACK = "infinispan-fallback.xml";

	private static Logger log = LoggerFactory.getLogger(JpaModule.class);

	private String jpaUnit;
	private boolean autoscan;
	private boolean autostart;

	private Properties properties;

	static {
		JpaScanner.exclude("com.axelor.test.db");
		JpaScanner.exclude("com.axelor.web.db");
	}

	/**
	 * Create new instance of the {@link JpaModule} with the given persistence
	 * unit name.
	 *
	 * If <i>autoscan</i> is true then a custom Hibernate scanner will be used
	 * to scan all the classpath entries for Entity classes.
	 *
	 * If <i>autostart</i> is true then the {@link PersistService} will be
	 * started automatically.
	 *
	 * @param jpaUnit
	 *            the persistence unit name
	 * @param autoscan
	 *            whether to enable autoscan
	 * @param autostart
	 *            whether to automatically start persistence service
	 */
	public JpaModule(String jpaUnit, boolean autoscan, boolean autostart) {
		this.jpaUnit = jpaUnit;
		this.autoscan = autoscan;
		this.autostart = autostart;
	}

	/**
	 * Create a new instance of the {@link JpaModule} with the given persistence
	 * unit name with <i>autoscan</i> and <i>autostart</i> enabled.
	 *
	 * @param jpaUnit
	 *            the persistence unit name
	 */
	public JpaModule(String jpaUnit) {
		this(jpaUnit, true, true);
	}

	public JpaModule scan(String pkg) {
		JpaScanner.include(pkg);
		return this;
	}

	/**
	 * Configures the JPA persistence provider with a set of properties.
	 *
	 * @param properties
	 *            A set of name value pairs that configure a JPA persistence
	 *            provider as per the specification.
	 * @return this instance itself
	 */
	public JpaModule properties(final Properties properties) {
		this.properties = properties;
		return this;
	}

	@Override
	protected void configure() {
		log.debug("Configuring database...");
		
		final AppSettings settings = AppSettings.get();
		final Properties properties = new Properties();

		if (this.properties != null) {
			properties.putAll(this.properties);
		}
		if (this.autoscan) {
			properties.put(Environment.SCANNER, JpaScanner.class.getName());
		}

		properties.put(Environment.INTERCEPTOR, AuditInterceptor.class.getName());
		properties.put(Environment.USE_NEW_ID_GENERATOR_MAPPINGS, "true");
		properties.put(Environment.IMPLICIT_NAMING_STRATEGY, ImplicitNamingStrategyImpl.class.getName());
		properties.put(Environment.PHYSICAL_NAMING_STRATEGY, PhysicalNamingStrategyImpl.class.getName());

		properties.put(Environment.AUTOCOMMIT, "false");
		properties.put(Environment.CONNECTION_PROVIDER_DISABLES_AUTOCOMMIT, "true");
		properties.put(Environment.MAX_FETCH_DEPTH, "3");

		// Use HikariCP as default pool provider
		properties.put(Environment.CONNECTION_PROVIDER, HikariCPConnectionProvider.class.getName());
		properties.put("hibernate.hikari.minimumIdle", "10");
		properties.put("hibernate.hikari.maximumPoolSize", "200");
		properties.put("hibernate.hikari.idleTimeout", "30000");

		// update properties with all hibernate.* settings from app configuration
		settings.getProperties().stringPropertyNames().stream()
			.filter(n -> n.startsWith("hibernate."))
			.forEach(n -> properties.put(n, settings.get(n)));

		configureCache(settings, properties);
		configureMultiTenancy(settings, properties);
		configureSearch(settings, properties);

		try {
			configureConnection(settings, properties);
		} catch (Exception e) {
		}

		install(new SearchModule());
		install(new TenantModule());
		install(new JpaPersistModule(jpaUnit).properties(properties));
		if (this.autostart) {
			bind(Initializer.class).asEagerSingleton();
		}
		bind(JPA.class).asEagerSingleton();
	}

	private void configureConnection(final AppSettings settings, final Properties properties) {
		if (DBHelper.isDataSourceUsed()) {
			properties.put(Environment.DATASOURCE, DBHelper.getDataSourceName());
			return;
		}

		final Map<String, String> keys = new HashMap<>();
		final String unit = jpaUnit.replaceAll("(PU|Unit)$", "").replaceAll("^persistence$", "default");

		keys.put("db.%s.ddl", Environment.HBM2DDL_AUTO);
		keys.put("db.%s.driver", Environment.JPA_JDBC_DRIVER);
		keys.put("db.%s.url", Environment.JPA_JDBC_URL);
		keys.put("db.%s.user", Environment.JPA_JDBC_USER);
		keys.put("db.%s.password", Environment.JPA_JDBC_PASSWORD);
		
		for (String key : keys.keySet()) {
			String name = keys.get(key);
			String value = settings.get(String.format(key, unit));
			if (!StringUtils.isBlank(value)) {
				properties.put(name, value.trim());
			}
		}
	}

	private void configureCache(final AppSettings settings, final Properties properties) {
		if (!DBHelper.isCacheEnabled()) {
			return;
		}

		properties.put(Environment.USE_SECOND_LEVEL_CACHE, "true");
		properties.put(Environment.USE_QUERY_CACHE, "true");

		final String jcacheProvider = settings.get(JCacheRegionFactory.PROVIDER);
		final String jcacheConfig = settings.get(JCacheRegionFactory.CONFIG_URI);

		if (jcacheProvider != null) {
			// use jcache
			properties.put(Environment.CACHE_REGION_FACTORY, JCacheRegionFactory.class.getName());
			properties.put(JCacheRegionFactory.PROVIDER, jcacheProvider);
			properties.put(JCacheRegionFactory.CONFIG_URI, jcacheConfig);
		} else {
			// use infinispan
			properties.put(Environment.CACHE_REGION_FACTORY, InfinispanRegionFactory.class.getName());
			String infinispanConfig = settings.get(InfinispanRegionFactory.INFINISPAN_CONFIG_RESOURCE_PROP);
			if (infinispanConfig == null) {
				infinispanConfig = ResourceUtils.getResource(INFINISPAN_CONFIG) != null
						? INFINISPAN_CONFIG
						: INFINISPAN_CONFIG_FALLBACK;
			}
			if (INFINISPAN_CONFIG_FALLBACK.equals(infinispanConfig)) {
				properties.put(Environment.DEFAULT_CACHE_CONCURRENCY_STRATEGY, "read-write");
			}
			properties.put(InfinispanRegionFactory.INFINISPAN_CONFIG_RESOURCE_PROP, infinispanConfig);
		}
	}

	private void configureMultiTenancy(final AppSettings settings, final Properties properties) {
		// multi-tenancy support
		if (settings.getBoolean(TenantModule.CONFIG_MULTI_TENANCY, false)) {
			properties.put(Environment.MULTI_TENANT, MultiTenancyStrategy.DATABASE.name());
			properties.put(Environment.MULTI_TENANT_CONNECTION_PROVIDER, TenantConnectionProvider.class.getName());
			properties.put(Environment.MULTI_TENANT_IDENTIFIER_RESOLVER, TenantResolver.class.getName());
		}
	}

	private void configureSearch(final AppSettings settings, final Properties properties) {
		// hibernate-search support
		if ("none".equalsIgnoreCase(settings.get(SearchModule.CONFIG_DIRECTORY_PROVIDER))) {
			properties.put(org.hibernate.search.cfg.Environment.AUTOREGISTER_LISTENERS, "false");
			properties.remove(SearchModule.CONFIG_DIRECTORY_PROVIDER);
		} else {
			if (properties.getProperty(SearchModule.CONFIG_DIRECTORY_PROVIDER) == null) {
				properties.setProperty(SearchModule.CONFIG_DIRECTORY_PROVIDER, SearchModule.DEFAULT_DIRECTORY_PROVIDER);
			}
			if (properties.getProperty(SearchModule.CONFIG_INDEX_BASE) == null) {
				properties.setProperty(SearchModule.CONFIG_INDEX_BASE,
						settings.getPath(SearchModule.CONFIG_INDEX_BASE, SearchModule.DEFAULT_INDEX_BASE));
			}
			properties.put(org.hibernate.search.cfg.Environment.MODEL_MAPPING, SearchMappingFactory.class.getName());
		}
	}

	public static class Initializer {

		@Inject
		Initializer(PersistService service) {
			log.debug("Starting database service...");
			service.start();
		}
	}
}
